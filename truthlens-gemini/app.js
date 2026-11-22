const $ = id => document.getElementById(id);
const state = {mode:'image',file:null,url:null,busy:false};
const MAX_IMAGE_MB = 15, MAX_VIDEO_MB=100;
function fmt(bytes){return bytes >= 1024*1024 ? `${(bytes/1024/1024).toFixed(1)} MB` : `${Math.round(bytes/1024)} KB`}
function setMode(mode){
 if(state.busy)return;
 state.mode=mode; clearFile();
 for(const [name,el] of [['image',$('imageTab')],['video',$('videoTab')]]){el.classList.toggle('active',name===mode);el.setAttribute('aria-selected',String(name===mode))}
 $('fileInput').accept=mode==='image'?'image/jpeg,image/png,image/webp':'video/*';
 $('dropHint').textContent=mode==='image'?'PNG, JPG, WEBP • Max 15 MB':'MP4, WEBM, MOV • Max 100 MB';
}
function clearFile(){if(state.url)URL.revokeObjectURL(state.url);state.file=null;state.url=null;$('fileInput').value='';$('emptyState').classList.remove('hidden');$('previewState').classList.add('hidden');$('dropzone').classList.remove('has-file');$('videoPreview').pause();$('videoPreview').removeAttribute('src');$('imagePreview').removeAttribute('src');$('analyzeBtn').disabled=true;$('btnText').textContent='SELECT A FILE TO START';showPanel('resultIdle')}
function showPanel(id){['resultIdle','resultLoading','resultReady','resultError'].forEach(n=>$(n).classList.toggle('hidden',n!==id))}
function error(msg){$('errorMessage').textContent=msg;showPanel('resultError')}
function selectFile(file){
 if(state.busy||!file)return;
 const type=state.mode;
 const valid=type==='image'?['image/jpeg','image/png','image/webp'].includes(file.type):file.type.startsWith('video/')||/\.(mp4|mov|webm|m4v)$/i.test(file.name);
 if(!valid){error('Please select a supported '+type+' file.');return}
 if(file.size>(type==='image'?MAX_IMAGE_MB:MAX_VIDEO_MB)*1024*1024){error(`File is too large. Limit: ${type==='image'?MAX_IMAGE_MB:MAX_VIDEO_MB} MB.`);return}
 if(state.url)URL.revokeObjectURL(state.url);
 state.file=file;state.url=URL.createObjectURL(file);
 $('emptyState').classList.add('hidden');$('previewState').classList.remove('hidden');$('dropzone').classList.add('has-file');
 const preview=type==='image' ? $('imagePreview'):$('videoPreview');
 $('imagePreview').classList.toggle('hidden',type!=='image');$('videoPreview').classList.toggle('hidden',type!=='video');
 preview.src=state.url;$('fileName').textContent=file.name;$('fileSize').textContent=fmt(file.size);$('analyzeBtn').disabled=false;$('btnText').textContent='ANALYZE '+type.toUpperCase();showPanel('resultIdle');
}
function imageFromUrl(url){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Could not decode image.'));im.src=url})}
function capture(source,maxWidth=900,quality=.73){const w=source.videoWidth||source.naturalWidth,h=source.videoHeight||source.naturalHeight;if(!w||!h)throw new Error('Media could not be decoded.');const scale=Math.min(1,maxWidth/Math.max(w,h));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));c.getContext('2d',{alpha:false}).drawImage(source,0,0,c.width,c.height);return c.toDataURL('image/jpeg',quality)}
async function videoFrames(url){
 const video=document.createElement('video');video.preload='auto';video.muted=true;video.playsInline=true;video.src=url;
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Video could not load. Use MP4 or WEBM.')),18000);video.onloadedmetadata=()=>{clearTimeout(timeout);resolve()};video.onerror=()=>{clearTimeout(timeout);reject(new Error('Video format unsupported in this browser. Try MP4.'))}});
 if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('Video duration is invalid.');
 const count=4;const frames=[];
 for(let i=0;i<count;i++){
   const time=Math.min(Math.max(0,video.duration-.08),Math.max(.01,video.duration*(.10+.8*i/(count-1))));
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Could not extract video frames.')),14000);video.onseeked=()=>{clearTimeout(timer);resolve()};video.onerror=()=>{clearTimeout(timer);reject(new Error('Could not decode video frames.'))};video.currentTime=time});
   frames.push(capture(video,640,.62));
 }
 video.removeAttribute('src');video.load();return frames;
}
async function analyze(){
 if(!state.file||state.busy)return;
 state.busy=true;$('analyzeBtn').disabled=true;$('btnText').textContent='ANALYZING...';$('loadingStatus').textContent=state.mode==='video'?'Sampling video frames':'Preparing visual data';showPanel('resultLoading');
 try{
   const frames=state.mode==='image'?[capture(await imageFromUrl(state.url))]:await videoFrames(state.url);
   $('loadingStatus').textContent='Requesting Gemini visual assessment';
   const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:state.mode,frames})});
   let result=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(result.error||`Server error ${response.status}`);
   showResult(result);
 }catch(e){error(e.message||'Unexpected error. Please try again.')}finally{state.busy=false;$('analyzeBtn').disabled=!state.file;$('btnText').textContent=state.file?'ANALYZE '+state.mode.toUpperCase():'SELECT A FILE TO START'}
}
function showResult(result){
 const titles={LIKELY_AI:'LIKELY AI-GENERATED',LIKELY_REAL:'LIKELY AUTHENTIC',UNCERTAIN:'INCONCLUSIVE'};
 const verdict=titles[result.verdict]||titles.UNCERTAIN;
 $('resultReady').className='result-ready'+(result.verdict==='LIKELY_AI'?' ai':result.verdict==='UNCERTAIN'?' uncertain':'');
 $('verdictHeading').textContent=verdict;
 $('resultMode').textContent=state.mode==='video'?'VIDEO / SAMPLED FRAMES':'IMAGE / SINGLE FRAME';
 const score=Math.max(0,Math.min(100,Number(result.score)||0));
 $('scoreValue').textContent=score;$('scoreInRing').textContent=score;$('scoreRing').style.setProperty('--amount',`${score}%`);
 $('resultSummary').textContent=result.summary||'The visual evidence is insufficient for a strong assessment.';
 $('signalsList').replaceChildren();
 const signals=Array.isArray(result.signals)&&result.signals.length?result.signals:['No specific visual signal was identified.'];
 for(const s of signals){const li=document.createElement('li');li.textContent=s;$('signalsList').append(li)}
 $('limitations').textContent='LIMITATIONS / '+(result.limitations||'This is an experimental, uncalibrated AI visual assessment, not proof.');
 showPanel('resultReady');
}
$('imageTab').addEventListener('click',()=>setMode('image'));
$('videoTab').addEventListener('click',()=>setMode('video'));
$('fileInput').addEventListener('change',e=>selectFile(e.target.files[0]));
$('dropzone').addEventListener('click',e=>{if(e.target.closest('video'))return;if(!state.busy)$('fileInput').click()});
$('dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!state.busy)$('fileInput').click()}});
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('dragover')});
for(const event of ['dragleave','drop'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('dragover')});
$('dropzone').addEventListener('drop',e=>selectFile(e.dataTransfer.files[0]));
$('analyzeBtn').addEventListener('click',analyze);
$('retryBtn').addEventListener('click',analyze);
$('resetBtn').addEventListener('click',clearFile);

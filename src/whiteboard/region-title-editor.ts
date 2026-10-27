export function editRegionTitle(label:HTMLElement,hooks:{title:string;save:(title:string)=>Promise<void>;notice:(message:string)=>void;done:()=>void}){
 if(label.querySelector('input'))return;
 const input=document.createElement('input');input.className='wb-group-title-input';input.value=hooks.title;input.maxLength=240;input.setAttribute('aria-label','分区标题');
 let finished=false;
 function restore(){label.textContent=hooks.title;hooks.done();}
 async function save(){if(finished)return;finished=true;const title=input.value.trim();if(!title||title===hooks.title){restore();return;}input.disabled=true;try{await hooks.save(title);hooks.done();}catch(error){finished=false;input.disabled=false;hooks.notice(String(error));input.focus();}}
 input.onpointerdown=e=>e.stopPropagation();input.ondblclick=e=>e.stopPropagation();input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'&&!e.isComposing){e.preventDefault();void save();}else if(e.key==='Escape'){e.preventDefault();finished=true;restore();}};input.onblur=()=>void save();label.replaceChildren(input);input.focus({preventScroll:true});input.select();
}

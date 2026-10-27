import {iconMarkup} from '../ui/icons.js';

// One official Lucide disclosure icon for every plugin surface, including dynamic menus.
export function uiAffordancesCss(){
 const mask='url("data:image/svg+xml,'+encodeURIComponent(iconMarkup('chevron'))+'")';
 return `
html body details:not(.wb-card-menu):not(.home-recent-menu)>summary{position:relative;list-style:none!important;padding-inline-start:18px!important}
html body details:not(.wb-card-menu):not(.home-recent-menu)>summary::-webkit-details-marker{display:none}
html body details:not(.wb-card-menu):not(.home-recent-menu)>summary::before{content:''!important;position:absolute;left:0;top:50%;width:12px!important;height:12px;flex:none;background:currentColor;mask:${mask} center/contain no-repeat;-webkit-mask:${mask} center/contain no-repeat;transform:translateY(-50%)!important;opacity:.7}
html body details[open]:not(.wb-card-menu):not(.home-recent-menu)>summary::before{transform:translateY(-50%) rotate(90deg)!important}
html body .preprocess-ai>summary::after{content:none!important}
html body *,html body{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--muted,#89939d) 32%,transparent) transparent}
html body *::-webkit-scrollbar{width:4px;height:4px}
html body *::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--muted,#89939d) 32%,transparent);border-radius:4px}
html body *::-webkit-scrollbar-track,html body *::-webkit-scrollbar-corner{background:transparent}
@supports selector(::-webkit-scrollbar){html body *,html body{scrollbar-width:auto!important}}
`;
}
export function installUiAffordances(doc:Document){
 if(doc.getElementById('artinfact-ui-affordances'))return;
 const style=doc.createElement('style');style.id='artinfact-ui-affordances';style.textContent=uiAffordancesCss();doc.head.append(style);
}

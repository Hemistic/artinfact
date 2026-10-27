import english from './ui-language-en.json';
export type UiLanguage='zh'|'en';
export function normalizeUiLanguage(value:unknown):UiLanguage{return typeof value==='string'&&/^en(?:-|$)/i.test(value)?'en':'zh';}
const catalog:Record<string,string>=english;
Object.assign(catalog,{'输入公式':'Enter a formula'});
Object.assign(catalog,{'布局疏密':'Layout spacing','拖动回弹':'Drag rebound','节点文字':'Node labels','字体大小':'Font size','紧凑':'Compact','标准':'Standard','疏松':'Spacious','柔和':'Soft','显示':'Show','隐藏':'Hide'});
Object.assign(catalog,{'界面语言':'Interface language','先保存修改，再重新加载界面。':'Changes are saved before the interface reloads.','默认中文，可切换为英文。论文与笔记内容保持原样。':'Chinese by default. Switch to English without changing papers or notes.','处':'places','个':'items','篇':'papers'});
const overrides:Record<string,string>={'工作区':'Workspace','白板':'Whiteboards','知识图谱':'Knowledge graph','关闭':'Close','图谱 / 白板':'Graph / Whiteboards','图谱处理':'Graph processing','设置':'Settings','插件设置':'Plugin settings','解析布局':'Parse layout','转化 Markdown':'Convert to Markdown','重新转换 Markdown':'Reconvert to Markdown','AI 大纲':'AI outline','AI 洞察':'AI insights','全文研读 · 尚未加入白板':'Full-paper review · Not on a whiteboard','待添加 · 卡片库':'Pending · Card library','摘要解读':'Interpret abstract','深入批注式阅读':'Read and annotate full paper','下载论文并添加到 workspace':'Download paper to workspace','已保存':'Saved','修改自动保存':'Changes save automatically','撤回':'Undo','恢复':'Restore','新建工作区':'New workspace','新建白板':'New whiteboard','定位 PDF 原文':'Go to PDF source','本机 MinerU':'Local MinerU','我的笔记':'My note'};
Object.assign(overrides,{'卡片菜单':'Card menu','编辑工具':'Editing tools','立即保存':'Save now','资料详情':'Source details','卡片宽度':'Card width','AI 改写选文／正文':'AI rewrite selection / document','撤销编辑':'Undo edit','重做编辑':'Redo edit','拖动笔记卡片':'Drag note card','笔记卡片正文':'Note card text'});
Object.assign(overrides,{'调整笔记卡片宽高':'Resize note card','拖动调整宽度与高度':'Drag to resize width and height','展开全文':'Expand full text','收起全文':'Collapse full text','收起到设定高度':'Collapse to the chosen height'});
Object.assign(overrides,{'删除卡片':'Delete card','已删除卡片 · Ctrl+Z 可恢复':'Card deleted · Ctrl+Z to restore','没有可撤销的操作':'Nothing to undo','没有可重做的操作':'Nothing to redo','已撤销':'Undone','已重做':'Redone'});
Object.assign(overrides,{'调整卡片宽高':'Resize card','固定左上角，拖动调整宽高':'Drag to resize with the top-left corner fixed'});
function phrase(value:string){const trim=value.trim(),translation=overrides[trim]??catalog[trim];return translation===undefined?value:value.replace(trim,translation);}
Object.assign(overrides,{'文件':'Files','文件管理':'Files','笔记':'Notes','工作区笔记':'Workspace notes','图谱':'Graph','摘要':'Summary','证据':'Evidence','原文证据':'Source evidence','公式':'Formula','参考文献':'References','图表':'Figures & tables','卡片':'Cards','资料':'Sources','待添加':'Pending','运行':'Run','停止':'Stop','加载':'Loading','预处理':'Preprocess','保存':'Save','重命名':'Rename','删除':'Delete','取消':'Cancel','确定':'Confirm','刷新':'Refresh','添加':'Add','返回工作区':'Back to workspace','图谱数据处理':'Graph data','外观与纸面颜色':'Appearance & paper','工作目录':'Working directory','笔记与来源':'Note & sources','更多':'More','卡片操作':'Card actions','关联 Pages':'Link Pages','打开引用的 Pages':'Open linked Pages','已删除 · 可撤回':'Deleted · Undo available','加粗':'Bold','斜体':'Italic','代码块':'Code block','引用块':'Blockquote','行内公式':'Inline formula','公式块':'Display formula','深入阅读':'Full-paper review','麻辣烫笔记':'Markdown note'});
Object.assign(overrides,{'请先在当前工作区打开一篇笔记，再返回 PDF 添加引用':'Open a note in this workspace, then return to the PDF to add a reference.','所选内容没有可以添加的文字或图片':'The selection has no text or images to add.','论文贡献与证据':'Paper contributions & evidence'});
Object.assign(overrides,{'Language / 语言':'Language','简体中文':'Simplified Chinese','切换前自动保存，内容保持原样。':'Changes save before switching. Your content stays unchanged.'});
export function translateUiText(value:string,language:UiLanguage):string{
 if(language!=='en')return value;
 if(!value.includes('<'))return phrase(value);
 return value.split(/(<[^>]*>)/g).map(part=>part.startsWith('<')?part.replace(/((?:title|placeholder|aria-label|alt)=["'])([^"']+)(["'])/g,(_,start,text,end)=>start+phrase(text)+end):phrase(part)).join('');
}
let messagePattern:RegExp|undefined;
let reverse:Map<string,string>|undefined;
export function originalUiText(value:string,language:UiLanguage){
 if(language!=='en')return value;
 if(!reverse){reverse=new Map();for(const [key,text]of Object.entries({...catalog,...overrides}))if(text&&!reverse.has(text))reverse.set(text,key);for(const [key,text]of Object.entries(overrides))if(text)reverse.set(text,key);}
 const trimmed=value.trim(),source=reverse.get(trimmed);return source?value.replace(trimmed,source):value;
}
export function translateUiMessage(value:string,language:UiLanguage):string{
 if(language!=='en')return value;const exact=translateUiText(value,language);if(exact!==value)return exact;
 messagePattern??=new RegExp(Object.keys({...catalog,...overrides}).filter(key=>key.length>=3&&key.length<350&&!/[<>\n]/.test(key)&&/[\u3400-\u9fff]/.test(key)).sort((a,b)=>b.length-a.length).map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
 return value.replace(messagePattern,part=>overrides[part]??catalog[part]??part);
}

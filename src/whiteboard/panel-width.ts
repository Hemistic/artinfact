export class PanelWidth {
 preferred:number;
 private available:number;
 private drag?:{pointer:number;x:number;width:number;value:number};
 constructor(value:number,available:number,fallback=420){this.preferred=Number.isFinite(value)&&value>0?value:fallback;this.available=available;}
 get bounds(){const max=Math.max(1,Math.min(760,this.available-32));return{min:Math.min(280,max),max};}
 private clamp(value:number){const {min,max}=this.bounds;return Math.round(Math.max(min,Math.min(max,value)));}
 get width(){return this.clamp(this.drag?.value??this.preferred);}
 get active(){return !!this.drag;}
 resize(available:number){this.available=available;}
 begin(pointer:number,x:number){if(!this.drag)this.drag={pointer,x,width:this.width,value:this.width};}
 move(pointer:number,x:number){if(this.drag?.pointer===pointer)this.drag.value=this.drag.width+this.drag.x-x;}
 end(pointer:number){if(this.drag?.pointer!==pointer)return;const width=this.width;this.drag=undefined;this.preferred=width;return width;}
 cancel(){this.drag=undefined;}
 set(width:number){this.cancel();this.preferred=this.clamp(width);return this.width;}
}

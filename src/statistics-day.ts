import type {Period} from './model';
import {addDays,isLocalDate,period} from './periods';

/** Calendar date only; browsing never writes settings, tasks or navigation. */
export class StatisticsDay {
  value:string;
  private bounds:Period;
  constructor(context:Period,today:string){this.bounds=context;this.value=context.type==='day'?context.start:this.contains(today)?today:context.start;}
  contains(value:string){return isLocalDate(value)&&value>=this.bounds.start&&value<this.bounds.end;}
  get min(){return this.bounds.start;}
  get max(){return addDays(this.bounds.end,-1);}
  get previousAvailable(){return this.value>this.min;}
  get nextAvailable(){return this.value<this.max;}
  rebase(context:Period,today:string){const changed=context.type!==this.bounds.type||context.start!==this.bounds.start;this.bounds=context;if(changed||!this.contains(this.value))this.value=this.contains(today)?today:context.start;}
  select(value:string){if(!this.contains(value))return false;this.value=value;return true;}
  shift(direction:1|-1){try{return this.select(addDays(this.value,direction));}catch{return false;}}
  get context(){return period('day',this.value);}
}

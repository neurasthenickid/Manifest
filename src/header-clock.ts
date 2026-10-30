export type Season='winter'|'spring'|'summer'|'autumn';
export type Daypart='morning'|'day'|'evening'|'night';
/** Calendar season can come from the open period; time always stays local. */
export function seasonForMonth(month:number):Season{return month===12||month<=2?'winter':month<=5?'spring':month<=8?'summer':'autumn';}
export function headerClock(date=new Date(),season:Season=seasonForMonth(date.getMonth()+1)):{season:Season;daypart:Daypart}{
 const minute=date.getHours()*60+date.getMinutes();
 const limits=season==='winter'?[360,691,961,1111]:season==='summer'?[301,601,1111,1411]:[360,631,991,1201];
 const daypart:Daypart=minute<limits[0]||minute>=limits[3]?'night':minute<limits[1]?'morning':minute<limits[2]?'day':'evening';return{season,daypart};
}

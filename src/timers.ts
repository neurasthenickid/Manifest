// Pure adapters run in the Node test runner too. Production always selects Window;
// this single documented globalThis fallback has no Node/Electron dependency.
const timerHost=typeof window==='undefined'?globalThis:window;
export const startTimeout=(fn:()=>void,ms:number)=>timerHost.setTimeout(fn,ms);
export const stopTimeout=(id:ReturnType<typeof startTimeout>|undefined)=>timerHost.clearTimeout(id);

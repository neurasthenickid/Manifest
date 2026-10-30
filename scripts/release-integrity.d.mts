export const sha:(bytes:Uint8Array|string)=>string;
export function sourceDigest(root?:string):Promise<string>;
export function artifactHashes(paths:string[]):Promise<Record<string,string>>;
export interface Proof {commit:string;source:string;artifacts:Record<string,string>}
export function verifyProof(proof:Proof,head:string,root?:string):Promise<void>;
export type CommandRunner=(args:string[])=>{status:number|null;stdout?:string;stderr?:string};
export function checkedCommand(run:CommandRunner,args:string[],allowMissing?:boolean):string|null;
export function verifyTag(run:CommandRunner,repository:string,tag:string,commit:string):void;
export interface ReleaseOptions {repository:string;commit:string;version:string;collectionTag:string;collectionVersion:string;collectionAssets:string[];codeAssets:string[];kind?:string}
export function createDrafts(run:CommandRunner,options:ReleaseOptions):number;

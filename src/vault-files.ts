interface Entry {path:string;children?:readonly Entry[]}
interface FileTree {getRoot():Entry;getAbstractFileByPath(path:string):Entry|null}
/** The vault already indexes its tree. Walk only the requested directory, without stale caches. */
export function listVaultFiles(vault:FileTree,prefix:string):string[]{
 const entry=prefix?vault.getAbstractFileByPath(prefix):vault.getRoot();if(!entry?.children)return [];
 const files:string[]=[];const visit=(node:Entry)=>{if(node.children)for(const child of node.children)visit(child);else files.push(node.path);};visit(entry);return files;
}

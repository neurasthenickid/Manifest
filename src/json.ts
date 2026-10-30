/** JSON is untrusted until narrowed. No schema-wide casts at storage boundaries. */
export function isObject(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function object(value:unknown):Record<string,unknown>{return isObject(value)?value:{};}
export function parseJSON(text:string):unknown{return JSON.parse(text) as unknown;}

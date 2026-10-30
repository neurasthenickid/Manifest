export const EXPECTED_DESCRIPTION:string;
export function validateManifest(manifest:unknown,pkg:unknown,versions:unknown):boolean;
export function verifyManifest(paths?:string[]):Promise<void>;

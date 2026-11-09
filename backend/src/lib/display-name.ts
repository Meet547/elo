/** Canonical identity for new names; legacy collisions stay untouched until renamed. */
export function displayName(input:unknown){
 if(typeof input!=='string')throw new Error('Enter a table name.');
 const name=input.normalize('NFKC').replace(/\s+/gu,' ').trim();
 if(Array.from(name).length<2||Array.from(name).length>18||!/^\p{L}[\p{L}\p{M}\p{N} _-]*$/u.test(name))throw new Error('Use 2–18 letters, numbers, spaces, underscores or hyphens, starting with a letter.');
 const key=name.toLowerCase();
 if(/^(admin|administrator|moderator|support|elo staff|system)(\b|[_-])/u.test(key)||/\b(fuck|shit|cunt|nigger)\b/u.test(key))throw new Error('Choose a different table name.');
 return {name,nameKey:key};
}

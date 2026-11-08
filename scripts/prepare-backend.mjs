import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('backend/.app');
// Generated API-only Next application; source of truth is backend/src plus shared lib.
await rm(`${root}/src`, { recursive: true, force: true });
await mkdir(`${root}/src`, { recursive: true });
await cp('src/lib', `${root}/src/lib`, { recursive: true });
await cp('src/store', `${root}/src/store`, { recursive: true });
await cp('backend/src', `${root}/src`, { recursive: true });
await writeFile(`${root}/src/app/layout.tsx`, 'export default function Layout({children}: {children: React.ReactNode}) { return <html><body>{children}</body></html>; }\n');
await writeFile(`${root}/tsconfig.json`, JSON.stringify({compilerOptions:{target:'ES2022',lib:['dom','esnext'],skipLibCheck:true,strict:true,noEmit:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',resolveJsonModule:true,isolatedModules:true,jsx:'react-jsx',plugins:[{name:'next'}],paths:{'@/*':['./src/*']}},include:['src/**/*.ts','src/**/*.tsx','.next/types/**/*.ts'],exclude:['node_modules']},null,2));
await writeFile(`${root}/package.json`, JSON.stringify({name:'elo-backend',private:true,version:'1.0.0'}));
await writeFile(`${root}/next.config.ts`, 'import type { NextConfig } from "next";\nconst config: NextConfig = { poweredByHeader:false, experimental:{cpus:2} };\nexport default config;\n');
console.log('Prepared backend/.app from backend/src and shared src/lib');

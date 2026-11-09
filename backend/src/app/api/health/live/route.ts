import {NextResponse} from 'next/server';
/** Process liveness deliberately makes no database or provider requests. */
export function GET(){return NextResponse.json({ok:true},{headers:{'cache-control':'no-store'}});}

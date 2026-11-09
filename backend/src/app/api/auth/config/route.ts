import {NextResponse} from 'next/server';
import {googleConfig} from '../../../../lib/google-auth';
/** Public capabilities only; never expose credentials or provider account details. */
export function GET(){
 let google=false;
 try{googleConfig();google=true;}catch{}
 return NextResponse.json({google},{headers:{'cache-control':'no-store'}});
}

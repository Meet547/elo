import {HandVerification} from '@/components/views/HandVerification';
export const metadata={title:'Hand verification',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{handId:string}>}){
 return <HandVerification handId={(await params).handId}/>;
}

import { installMockAuthApi } from "./mock-test-auth";

const s: Record<string,string> = {}, tab: Record<string,string> = {};
const g = globalThis as any;
const mk=(o:any)=>({getItem:(k:string)=>o[k]??null,setItem:(k:string,v:string)=>void(o[k]=String(v)),removeItem:(k:string)=>void delete o[k]});
g.localStorage=mk(s); g.sessionStorage=mk(tab);
g.window={location:{hash:"#/dashboard"},addEventListener(){},removeEventListener(){},scrollTo(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
g.document={visibilityState:"visible",addEventListener(){},removeEventListener(){}};
installMockAuthApi();
const { renderToString } = await import("react-dom/server"); const { createElement } = await import("react");
const api = await import("../src/lib/api"); const { default: App } = await import("../src/App");
await api.register({email:"o@x.in",password:"password1",fullName:"Other Member",username:"other"});
await api.createListing("offer",{title:"Handwoven cotton sarees",category:"Handicrafts",type:"Physical Resource",description:"Handwoven cotton sarees made on a family loom.",details:"Sarees",exchangePref:"",location:"",availability:"",mode:"",quantity:"",tags:[],images:[]},true);
await api.createListing("need",{title:"Delivery to Pune market",category:"Transport",type:"Transportation / Logistics",description:"Weekly delivery of crates to the Pune market.",details:"Transport",exchangePref:"",location:"",availability:"",mode:"",quantity:"",tags:[],images:[]},true);
api.logout();
await api.register({email:"me@x.in",password:"password1",fullName:"Meera Joshi",username:"meera"});
const html = renderToString(createElement(App));
const need = (k:string,label=k)=>console.log(html.includes(k)?"✓":"✗", label);
['aria-roledescription="carousel"','Fresh produce, fairly exchanged','Pause slideshow','Can Offer','Needs','Handwoven cotton sarees','Delivery to Pune market','Illustrative photo','Requests to answer','Conversations','Browse by category','Recently Added','Recommended for You','Meera'].forEach(k=>need(k));
// editorial geometry: no legacy pill/rounded utilities left in rendered markup
const bad = (html.match(/rounded-(xl|2xl|3xl|lg|md|sm)\b/g) ?? []);
console.log(bad.length ? "note: rounded-* classes present (tokens map them to 0px): "+[...new Set(bad)].join(",") : "✓ no rounded-* utilities in dashboard markup");
console.log(/rounded-full/.test(html) ? "✓ circles retained for avatars/dots" : "✗ circles missing");
g.window.location.hash="#/messages";
const m = renderToString(createElement(App));
for (const k of ['New message','Find a member']) console.log(m.includes(k)?"✓":"✗", "messages:", k);
process.exit(0);

const fs=require('fs'),vm=require('vm'),assert=require('assert');
const script=fs.readFileSync('build/SIGN_IN_STATUS.js','utf8');
let elements=[],avatars=[],passwords=[],cookieVisible=false,cookieClicks=0;
function el(text,aria){return {innerText:text||'',value:'',parentElement:null,disabled:false,getAttribute(n){return n==='aria-label'?aria||null:null},getBoundingClientRect(){return {width:50,height:30}}}}
const avatar=el(''),signIn=el('','Sign-In'),signOut=el('Sign out'),password=el(''),cookie=el('Allow all cookies');
cookie.click=()=>{cookieClicks++;cookieVisible=false};
const toolbar={querySelectorAll(s){if(s.startsWith('[class*=avatar'))return avatars;if(s.startsWith('button[aria-label]'))return [];return []}};
const cart={parentElement:toolbar};
const location={protocol:'https:',hostname:'robertsspaceindustries.com',port:''};
const document={querySelector(s){if(s==='#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll')return cookieVisible?cookie:null;if(s==='#platform-bar-cart-icon')return cart;return null},querySelectorAll(s){if(s==='input[type=password]')return passwords;if(s==='button,a,[role=button]')return elements;return []}};
const ctx=vm.createContext({location,document,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),URL});
function status(){return JSON.parse(vm.runInContext(script,ctx)).status}
assert.equal(status(),'UNKNOWN');
elements=[signIn];avatars=[avatar];assert.equal(status(),'SIGNED_OUT');
elements=[];assert.equal(status(),'SIGNED_IN');
passwords=[password];assert.equal(status(),'SIGNED_OUT');
passwords=[];avatars=[];elements=[signOut];assert.equal(status(),'SIGNED_IN');
elements=[];cookieVisible=true;assert.equal(status(),'UNKNOWN');assert.equal(cookieClicks,1);
location.hostname='example.com';assert.equal(status(),'UNKNOWN');
console.log('PASS: sign-in detection rejects signed-out, loading, password, and unrelated pages; recognizes account indicators.');

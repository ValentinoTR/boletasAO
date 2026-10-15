const host = window.parent !== window && window.parent.AOQuoteHost;
if (!host) { location.replace('./'); throw Error('Abre las cotizaciones desde tu cuenta de AO Nexus.'); }
'use strict';
// Editor de cotizaciones: mismo diseño y PDF que la boleta, pero una cotización nunca aparta ni descuenta stock.
const quoteAssetCache=new Map();
async function quoteBytes(url){if(!quoteAssetCache.has(url))quoteAssetCache.set(url,fetch(url).then(async r=>{if(!r.ok)throw Error('No se pudo cargar un recurso del PDF.');return new Uint8Array(await r.arrayBuffer());}).catch(e=>{quoteAssetCache.delete(url);throw e;}));return quoteAssetCache.get(url);}
const TEMPLATE = 'assets/receipt-template.png';
const FONT_REGULAR = 'assets/receipt-regular.ttf';
const FONT_BOLD = 'assets/receipt-bold.ttf';
const FONT_ITALIC = 'assets/receipt-italic.ttf';
async function embedQuoteFonts(doc){doc.registerFontkit(fontkit);return {regular:await doc.embedFont(await quoteBytes(FONT_REGULAR),{subset:true}),bold:await doc.embedFont(await quoteBytes(FONT_BOLD),{subset:true}),italic:await doc.embedFont(await quoteBytes(FONT_ITALIC),{subset:true})};}
async function loadPreviewFonts(){const definitions=[[FONT_REGULAR,'normal','400'],[FONT_BOLD,'normal','700'],[FONT_ITALIC,'italic','400']];await Promise.all(definitions.map(async([url,style,weight])=>{const face=new FontFace('AOReceipt',`url(${url})`,{style,weight});await face.load();document.fonts.add(face);}));}
const STORAGE_KEY = 'ao-nexus-cotizacion-v1-'+host.userId, NOTES_KEY = 'ao-nexus-cotizacion-condiciones-'+host.userId;
const VERSION = 1, MAX_CENTS = 99999999999, MAX_ITEMS = 100, MAX_PARTS = 9999, VALID_DAYS = [3,7,15,30], DEFAULT_VALID_DAYS = 7;
const DEFAULT_NOTES = 'Precios en soles. Sujeto a disponibilidad de stock.\n1 AÑO DE GARANTÍA.';
const PAGE_W = 595.5, PAGE_H = 842.25, NOTES_X = 108, NOTES_W = 446, NOTES_SIZE = 9.4, MAX_NOTE_LINES = 12;
const $ = id => document.getElementById(id);
const escapeXML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanText = s => String(s??'').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/[\u200b-\u200d\ufeff]/g,'');
let fonts=null;
// Fechas en la hora de Lima (AAAA-MM-DD) y su formato impreso dd/mm/aaaa.
function today(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>parts.find(p=>p.type===t).value;return `${get('year')}-${get('month')}-${get('day')}`;}
function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s)))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
function addDays(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function daysBetween(from,to){return Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);}
function formatDate(iso){const f=String(iso||'').split('-');return f.length===3?`${f[2]}/${f[1]}/${f[0]}`:'';}
function quoteLabel(number){return 'COT-'+String(number).padStart(5,'0');}
// Estado según la fecha de hoy: Pendiente, Vence pronto (≤ 2 días), Vencida o Convertida.
function quoteStatus(validUntil,now=today(),converted=false,receiptLabel=null){
 if(converted)return {key:'converted',text:'Convertida'+(receiptLabel?' · '+receiptLabel:'')};
 const left=daysBetween(now,validUntil);
 if(left<0)return {key:'expired',text:'Vencida'};
 if(left<=2)return {key:'expiring',text:left===0?'Vence hoy':left===1?'Vence mañana':`Vence en ${left} días`};
 return {key:'pending',text:'Pendiente'};
}
function newItem(){return {description:'',code:'',unit:'NIU',quantity:'1',price:'',parts:[],mode:'units'};}
function emptyQuote(notes=DEFAULT_NOTES,validDays=DEFAULT_VALID_DAYS){const date=today();return {version:VERSION,date,validDays,validUntil:addDays(date,validDays),customer:'',docType:'DNI',document:'',phone:'',email:'',address:'',notes,items:[newItem()]};}
function centsFromInput(value){const s=String(value).trim();if(!/^\d{1,9}([.,]\d{1,2})?$/.test(s))return null;const [a,b='']=s.split(/[.,]/);const c=Number(a)*100+Number(b.padEnd(2,'0'));return c<=MAX_CENTS?c:null;}
function quantityFromInput(value){const s=String(value).trim();return /^\d{1,4}$/.test(s)&&Number(s)>0?Number(s):null;}
function formatMoney(cents){return 'S/ '+(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function numberWords(n,apocope=false){
 if(!Number.isInteger(n)||n<0||n>999999999)throw Error('Importe fuera de rango.');
 const small=['CERO','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE','VEINTIUNO','VEINTIDÓS','VEINTITRÉS','VEINTICUATRO','VEINTICINCO','VEINTISÉIS','VEINTISIETE','VEINTIOCHO','VEINTINUEVE'];
 function below1000(x){if(x<30)return small[x];if(x<100)return ['','','','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'][Math.floor(x/10)]+(x%10?' Y '+small[x%10]:'');if(x===100)return 'CIEN';return ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'][Math.floor(x/100)]+(x%100?' '+below1000(x%100):'');}
 function ap(s){return s.replace(/VEINTIUNO$/,'VEINTIÚN').replace(/UNO$/,'UN');}
 function belowMillion(x){if(x<1000)return below1000(x);return (Math.floor(x/1000)===1?'MIL':ap(below1000(Math.floor(x/1000)))+' MIL')+(x%1000?' '+below1000(x%1000):'');}
 let out=n<1000000?belowMillion(n):(Math.floor(n/1000000)===1?'UN MILLÓN':ap(below1000(Math.floor(n/1000000)))+' MILLONES')+(n%1000000?' '+belowMillion(n%1000000):'');
 return apocope?ap(out):out;
}
function amountInWords(cents){if(!Number.isSafeInteger(cents)||cents<0||cents>MAX_CENTS)throw Error('Importe fuera de rango.');const whole=Math.floor(cents/100),fraction=cents%100;return numberWords(whole,true)+(whole===1?' SOL':whole>0&&whole%1000000===0?' DE SOLES':' SOLES')+(fraction?' CON '+numberWords(fraction,true)+(fraction===1?' CÉNTIMO':' CÉNTIMOS'):'');}
function calculate(d){let total=0;const rows=d.items.map(item=>{const qty=quantityFromInput(item.quantity),price=centsFromInput(item.price);const amount=qty!==null&&price!==null?qty*price:0;total+=amount;return {...item,qty,priceCents:price,amount};});return {total,rows,withinLimit:Number.isSafeInteger(total)&&total<=MAX_CENTS};}
// Referencias a productos (nunca unidades): de tu web, de Compras sin producto o a pedido.
function cleanPart(p){
 if(!p||typeof p!=='object'||!['product','loose','external'].includes(p.source))return null;
 const name=cleanText(p.name).replace(/\s+/g,' ').trim().slice(0,350),cents=centsFromInput(String(p.price??'').trim());
 if(!name||cents===null)return null;
 const part={source:p.source,name,price:(cents/100).toFixed(2)};
 if(p.source==='product'){const id=cleanText(p.productId).trim().slice(0,64);if(!id)return null;part.productId=id;}
 if(p.source==='loose'){const key=cleanText(p.key).slice(0,200);if(!key.trim())return null;part.key=key;}
 return part;
}
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function normalizeQuote(input){
 if(!input||typeof input!=='object'||input.version!==VERSION||!Array.isArray(input.items)||input.items.length<1||input.items.length>MAX_ITEMS)throw Error('La cotización guardada no es válida.');
 const base=emptyQuote(DEFAULT_NOTES);
 for(const [key,max] of Object.entries({date:10,customer:110,docType:4,document:20,phone:20,email:254,address:160,notes:800}))base[key]=cleanText(input[key]??base[key]).slice(0,max).replace(key==='notes'?/\r/g:/\s+/g,key==='notes'?'':' ');
 if(!validDate(base.date))base.date=today();
 if(!['DNI','RUC','CE','PAS','NONE'].includes(base.docType))base.docType='DNI';
 if(base.docType==='NONE')base.document='';
 base.validDays=VALID_DAYS.includes(Number(input.validDays))?Number(input.validDays):DEFAULT_VALID_DAYS;base.validUntil=addDays(base.date,base.validDays);
 base.items=input.items.map(item=>{if(!item||typeof item!=='object')throw Error('La cotización contiene productos inválidos.');const it=newItem();for(const [key,max] of Object.entries({description:350,code:22,unit:5,quantity:4,price:12}))it[key]=cleanText(item[key]??it[key]).slice(0,max).replace(/\s+/g,' ');it.parts=(Array.isArray(item.parts)?item.parts:[]).slice(0,MAX_PARTS).map(cleanPart).filter(Boolean);it.mode=item.mode==='bundle'&&it.parts.length?'bundle':'units';return it;});
 return base;
}
// Copia con fecha de hoy y la misma validez (la copia no tiene número hasta guardarla).
function duplicateQuote(q){const copy=normalizeQuote(structuredClone(q)),date=today();copy.date=date;copy.validUntil=addDays(date,copy.validDays);return copy;}
function hasContent(d){return !!(d.customer.trim()||d.document.trim()||d.phone.trim()||d.email.trim()||d.address.trim()||d.items.some(i=>i.description.trim()||i.price.trim()||i.code.trim()||i.parts.length));}
const autoDescription=parts=>parts.length?(parts.every(p=>p.name===parts[0].name)?parts[0].name:'Computadora completa: '+parts.map(p=>p.name).join(', ')).slice(0,350):'';
// Reparte un importe entre las partes en proporción a sus precios (igual que en la boleta).
function repriceParts(parts,totalCents){
 if(!parts.length)return [];
 let weights=parts.map(p=>BigInt(centsFromInput(p.price)??0)),sum=weights.reduce((n,w)=>n+w,0n);
 if(sum===0n){weights=parts.map(()=>1n);sum=BigInt(parts.length);}
 const total=BigInt(totalCents),result=weights.map((w,i)=>({i,value:total*w/sum,remainder:total*w%sum}));
 const remainder=Number(total-result.reduce((n,r)=>n+r.value,0n));
 const sorted=[...result].sort((a,b)=>a.remainder>b.remainder?-1:a.remainder<b.remainder?1:a.i-b.i);
 for(let i=0;i<remainder;i++)sorted[i].value++;
 return parts.map((p,i)=>({...p,price:(Number(result[i].value)/100).toFixed(2)}));
}
// Reglas de la línea tras elegir productos: iguales → unidades (cantidad = partes); distintos → una computadora.
function applyPick(item,selected){
 const previous=item.parts||[],parts=(Array.isArray(selected)?selected:[]).slice(0,MAX_PARTS).map(cleanPart).filter(Boolean);
 item.parts=parts;
 if(parts.length){const same=parts.every(p=>p.name===parts[0].name&&p.price===parts[0].price);item.mode=same?'units':'bundle';item.quantity=same?String(parts.length):'1';item.price=same?parts[0].price:(parts.reduce((n,p)=>n+centsFromInput(p.price),0)/100).toFixed(2);}
 else item.mode='units';
 if(!item.description.trim()||item.description===autoDescription(previous))item.description=autoDescription(parts);
 return item;
}
// Al cambiar cantidad o precio a mano, las partes siguen cuadrando con la línea.
function syncParts(item){
 if(!item.parts.length)return item;
 const qty=quantityFromInput(item.quantity),price=centsFromInput(item.price);
 if(item.mode==='bundle'){if(price!==null)item.parts=repriceParts(item.parts,price);return item;}
 if(qty!==null&&qty!==item.parts.length)item.parts=qty<item.parts.length?item.parts.slice(0,qty):item.parts.concat(Array.from({length:qty-item.parts.length},()=>({...item.parts[0]})));
 if(price!==null){const unit=(price/100).toFixed(2);item.parts=item.parts.map(p=>({...p,price:unit}));}
 return item;
}
// WhatsApp: 9 dígitos que empiezan con 9 → celular peruano (+51); 51 + 9 dígitos o números de 8 a 15 dígitos se usan tal cual.
function normalizePhone(phone){const digits=String(phone??'').replace(/\D/g,'');if(/^9\d{8}$/.test(digits))return '51'+digits;if(/^51\d{9}$/.test(digits))return digits;return /^\d{8,15}$/.test(digits)?digits:'';}
function whatsappURL(phone,text){const number=normalizePhone(phone);return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;}
function shareText(d,label){const name=d.customer.trim().replace(/\s+/g,' ');const calc=calculate(d);return `Hola${name?' '+name:''}, te comparto la cotización ${label} de AO Nexus por ${formatMoney(calc.withinLimit?calc.total:0)}, válida hasta el ${formatDate(d.validUntil)}. Cualquier consulta, estoy atento.`;}
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$/.test(value.trim());
const validPhone=value=>{const s=String(value??'').trim();return !s||/^[\d\s+()-]+$/.test(s)&&/^\d{6,15}$/.test(s.replace(/[\s+()-]/g,''));};
function safeWidth(text,size,font='regular'){try{return fonts[font].widthOfTextAtSize(text,size);}catch(e){return [...text].length*size*.56;}}
function wrapText(text,width,size,font='regular'){const lines=[];for(const paragraph of cleanText(text).replace(/\r/g,'').split('\n')){let line='';for(const word of paragraph.split(/\s+/).filter(Boolean)){const test=line?line+' '+word:word;if(safeWidth(test,size,font)<=width){line=test;continue;}if(line){lines.push(line);line='';}if(safeWidth(word,size,font)<=width){line=word;continue;}let part='';for(const char of word){if(part&&safeWidth(part+char,size,font)>width){lines.push(part);part='';}part+=char;}line=part;}lines.push(line);}return lines.length?lines:[''];}
function fittedLines(text,width,size,minSize,maxLines,font='regular'){let lines=wrapText(text,width,size,font);while(lines.length>maxLines&&size>minSize){size=Math.max(minSize,size-.2);lines=wrapText(text,width,size,font);}return {lines,size};}
const noteLines=notes=>wrapText(notes.trim().replace(/\n\s*\n/g,'\n'),NOTES_W,NOTES_SIZE);
function validate(d){
 const errors=[];const fail=(id,msg)=>errors.push({id,msg});
 if(!d.customer.trim())fail('customer','Completa el nombre del cliente.');
 const doc=d.document.trim();
 if(d.docType==='DNI'&&doc&&!/^\d{8}$/.test(doc))fail('document','El DNI debe tener 8 dígitos, o déjalo vacío.');
 if(d.docType==='RUC'&&doc&&!/^\d{11}$/.test(doc))fail('document','El RUC debe tener 11 dígitos, o déjalo vacío.');
 if(!validPhone(d.phone))fail('phone','Revisa el teléfono: debe tener entre 6 y 15 dígitos, o déjalo vacío.');
 if(d.email.trim()&&!validEmail(d.email))fail('email','Revisa el correo del cliente, o déjalo vacío.');
 if(!VALID_DAYS.includes(Number(d.validDays)))fail('validDays','Elige la validez de la cotización.');
 if(!d.items.length)fail('addBtn','Agrega al menos un producto.');
 d.items.forEach((item,i)=>{const n=i+1;
  if(!item.description.trim())fail(`description-${i}`,`Producto ${n}: completa la descripción o pulsa «Elegir de mi stock».`);
  if(quantityFromInput(item.quantity)===null)fail(`quantity-${i}`,`Producto ${n}: la cantidad debe ser un entero entre 1 y 9999.`);
  else if(item.mode==='bundle'&&item.parts.length&&item.quantity.trim()!=='1')fail(`quantity-${i}`,`Producto ${n}: cada grupo de componentes es una computadora. Para cotizar otra, agrega otro producto.`);
  if(centsFromInput(item.price)===null)fail(`price-${i}`,`Producto ${n}: ingresa un precio válido, sin separadores de miles y con hasta 2 decimales.`);
  if(!item.unit.trim())fail(`unit-${i}`,`Producto ${n}: completa la unidad de medida (por ejemplo, NIU).`);
 });
 if(noteLines(d.notes).length>MAX_NOTE_LINES)fail('notes','Acorta las condiciones a un máximo de 12 líneas.');
 if(!calculate(d).withinLimit)fail('total','El importe total no puede superar S/ 999,999,999.99.');
 if(fonts){let supported=null;try{supported=new Set(fonts.regular.getCharacterSet());}catch(e){}
  if(supported){const bad=t=>[...String(t).replace(/[\n\r\t]/g,' ')].some(ch=>!supported.has(ch.codePointAt(0)));
   const fields=[['customer',d.customer],['document',d.document],['phone',d.phone],['address',d.address],['notes',d.notes],...d.items.flatMap((it,i)=>[[`description-${i}`,it.description],[`code-${i}`,it.code],[`unit-${i}`,it.unit]])];
   const hit=fields.find(([,t])=>bad(t));if(hit)fail(hit[0],'Hay un símbolo que no se puede incluir en el PDF. Retira emojis o caracteres de otros alfabetos. Las tildes y la ñ sí están permitidas.');}}
 return errors;
}
// Páginas del PDF como operaciones (rectángulos y textos): la misma escena sirve para la vista previa SVG y para pdf-lib.
function buildScenes(d,label='BORRADOR'){
 const calc=calculate(d),groups=[];let rows=[],used=0;
 for(const [i,row] of calc.rows.entries()){let descSize=7.7,lineHeight=10;let lines=wrapText((row.description||' ').replace(/\s+/g,' '),223,descSize);const code=row.code.trim()?fittedLines(row.code.trim(),42,8.4,5.6,1):{lines:[],size:8.4};let height=Math.max(26,lines.length*lineHeight+10,code.lines.length*9.5+10);if(height>165){descSize=7;lineHeight=9;lines=wrapText((row.description||' ').replace(/\s+/g,' '),223,descSize);height=Math.max(26,lines.length*lineHeight+10,code.lines.length*9.5+10);}if(rows.length&&used+height>165){groups.push(rows);rows=[];used=0;}rows.push({...row,i,lines,code,height,descSize,lineHeight});used+=height;}
 if(rows.length)groups.push(rows);
 return groups.map((group,pi)=>{const ops=[];const rect=(x,y,w,h,fill='#ffffff',stroke=null,lineWidth=.7)=>ops.push({type:'rect',x,y,w,h,fill,stroke,lineWidth});const text=(value,x,y,size=10,font='regular',color='#000000',align='left')=>{value=String(value);let tx=x;if(align==='center')tx-=safeWidth(value,size,font)/2;if(align==='right')tx-=safeWidth(value,size,font);ops.push({type:'text',value,x:tx,y,size,font,color});};const fitText=(value,x,y,width,size=9.5,font='regular',align='left',color='#000000')=>{while(safeWidth(String(value),size,font)>width&&size>5.2)size-=.2;text(String(value).replace(/\s+/g,' '),x,y,size,font,color,align);};
 // Recuadro del documento: COTIZACIÓN y su número (o BORRADOR mientras no se guarda).
 rect(393.7,63.6,172.8,116.9,'#ffffff','#252525',1);
 text('COTIZACIÓN',480.1,111,17,'regular','#101010','center');rect(452.1,120.5,56,1.1,'#7035b2');fitText(label,480.1,140,150,11,'bold','center');
 text('AO Nexus',290.5,89.7,10,'bold','#000000','center');['VENTA DE COMPUTADORAS,','COMPONENTES Y ACCESORIOS','Contacto: 936 177 329','Av. Inca Garcilaso de la Vega 1348','Tienda 2B-147','Centro de Lima'].forEach((v,i)=>text(v,290.5,103.2+i*13.5,10,'italic','#000000','center'));
 // Cliente a la izquierda (se omiten los datos vacíos); documento y fechas a la derecha.
 const left=[['CLIENTE:',fittedLines((d.customer.trim()||' ').replace(/\s+/g,' '),272,10,5.8,2)]];
 if(d.address.trim())left.push(['DIRECCIÓN:',fittedLines(d.address.trim().replace(/\s+/g,' '),272,10,6,2)]);
 if(d.phone.trim())left.push(['TELÉFONO:',{lines:[d.phone.trim().replace(/\s+/g,' ')],size:10}]);
 left.push(['MONEDA:',{lines:['SOLES'],size:10}]);
 // Filas cada 19 pt; si el nombre o la dirección ocupan 2 líneas, se juntan para no tocar la tabla (última línea ≤ 286).
 const extra=left.reduce((n,[,f])=>n+(f.lines.length-1)*10.5,0),gap=left.length>1?Math.min(19,(62-extra)/(left.length-1)):0;
 let ly=224;for(const [name,field] of left){text(name,48,ly,10,'bold');field.lines.forEach((v,i)=>fitText(v,118,ly+i*10.5,272,field.size));ly+=(field.lines.length-1)*10.5+gap;}
 const right=[];if(d.docType!=='NONE'&&d.document.trim())right.push([{DNI:'DNI:',RUC:'RUC:',CE:'C.E.:',PAS:'PASAP.:'}[d.docType]||'DOC.:',d.document.trim()]);right.push(['FECHA:',formatDate(d.date)],['VÁLIDA HASTA:',formatDate(d.validUntil)]);
 right.forEach(([name,value],i)=>{text(name,400,224+i*19,10,'bold');fitText(value,486,224+i*19,80,10);});
 let y=322;for(const row of group){fitText(row.i+1,52.8,y+10,23,9,'regular','center');fitText(row.quantity,90.8,y+10,38,9,'regular','center');fitText(row.unit,137,y+10,36,9,'regular','center');row.code.lines.forEach((v,i)=>text(v,184.8,y+10+i*9.5,row.code.size,'regular','#000000','center'));row.lines.forEach((v,i)=>text(v,211.8,y+10+i*row.lineHeight,row.descSize));fitText(row.priceCents===null?'':formatMoney(row.priceCents),496,y+10,50,8.5,'regular','right');fitText(row.amount<=MAX_CENTS?formatMoney(row.amount):'—',556.6,y+10,52,8.5,'regular','right');y+=row.height;}
 // Pie: importe en letras, total y condiciones (en varias páginas, el subtotal de cada una).
 rect(29,497,538,120,'#ffffff');const final=pi===groups.length-1;const words=final?(calc.withinLimit?amountInWords(calc.total):'REVISAR IMPORTE'):'CONTINÚA EN LA SIGUIENTE PÁGINA';text('SON:',38,517,8.2,'bold');const wordLines=wrapText(words,316,9.4);wordLines.forEach((v,i)=>text(v,64.3,517+i*11.5,9.4));text(final?'IMPORTE TOTAL':'SUBTOTAL PÁGINA',391,517,8.1,'bold');fitText(formatMoney(final?(calc.withinLimit?calc.total:0):group.reduce((s,r)=>s+r.amount,0)),566.5,517,85,10,'regular','right');
 const boxY=Math.max(535,517+(wordLines.length-1)*11.5+17);const all=final?(d.notes.trim()?noteLines(d.notes):[]):['La cotización continúa en la siguiente página.'];const lines=all.length>MAX_NOTE_LINES?[...all.slice(0,MAX_NOTE_LINES-1),'[Acorta las condiciones antes de descargar]']:all;const boxHeight=Math.max(56,25+lines.length*12);rect(31,boxY,532,boxHeight,'#ffffff','#7035b2',.8);text('CONDICIONES:',39,boxY+18,8.2,'bold');lines.forEach((v,i)=>text(v,NOTES_X,boxY+18+i*12,NOTES_SIZE));
 if(final){const fy=boxY+boxHeight+24;fitText(`Cotización válida hasta el ${formatDate(d.validUntil)}. Precios en soles sujetos a disponibilidad de stock.`,PAGE_W/2,fy,500,8.6,'italic','center','#5f5a66');text('Documento informativo: no es un comprobante de pago.',PAGE_W/2,fy+12.5,8.6,'italic','#5f5a66','center');text('Gracias por tu preferencia.',PAGE_W/2,fy+34,10.5,'bold','#7035b2','center');}
 if(groups.length>1)text(`Página ${pi+1} de ${groups.length}`,566,813,8,'regular','#777777','right');return ops;});
}
function sceneSVG(ops,title){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" role="img" aria-label="${escapeXML(title)}"><rect width="100%" height="100%" fill="white"/><image href="${TEMPLATE}" x="3.337059" y="4.25354" width="593.47363" height="838.065735"/>`+ops.map(o=>o.type==='rect'?`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${o.fill}"${o.stroke?` stroke="${o.stroke}" stroke-width="${o.lineWidth}"`:''}/>`:`<text x="${o.x}" y="${o.y}" font-family="AOReceipt, Arial, Helvetica, sans-serif" font-size="${o.size}" font-weight="${o.font==='bold'?'700':'400'}" font-style="${o.font==='italic'?'italic':'normal'}" fill="${o.color}">${escapeXML(o.value)}</text>`).join('')+'</svg>';}
function rgbHex(hex){return PDFLib.rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);}
async function generatePDF(d,label='BORRADOR'){const doc=await PDFLib.PDFDocument.create();const docFonts=await embedQuoteFonts(doc);const bg=await doc.embedPng(await quoteBytes(TEMPLATE));const layouts=buildScenes(d,label);doc.setTitle(`Cotización ${label} · AO Nexus`);doc.setAuthor('AO Nexus');doc.setCreator('AO Nexus · Gestor de cotizaciones');doc.setProducer('AO Nexus');doc.setSubject('Cotización');doc.setLanguage('es-PE');for(const ops of layouts){const p=doc.addPage([PAGE_W,PAGE_H]);p.drawImage(bg,{x:3.337059,y:PAGE_H-4.25354-838.065735,width:593.47363,height:838.065735});for(const o of ops){if(o.type==='rect')p.drawRectangle({x:o.x,y:PAGE_H-o.y-o.h,width:o.w,height:o.h,color:rgbHex(o.fill),...(o.stroke?{borderColor:rgbHex(o.stroke),borderWidth:o.lineWidth}:{})});else p.drawText(o.value,{x:o.x,y:PAGE_H-o.y,size:o.size,font:docFonts[o.font],color:rgbHex(o.color)});}}return doc.save();}
function pdfFilename(d,label){const name=(d.customer||'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9 _-]/g,'').trim().replace(/\s+/g,'-').slice(0,45);return `Cotizacion-${label}-${name||'cliente'}.pdf`;}
function download(bytes,filename,mime){const blob=new Blob([bytes],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}

// ---------- Pantalla ----------
const ICONS={download:'<path d="M12 3v12m-5-5 5 5 5-5M5 15v5h14v-5"/>',save:'<path d="M5 3h11l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 3v5h7M8 21v-7h8v7"/>',share:'<path d="M20.5 11.6a8.6 8.6 0 0 1-12.7 7.6L3.5 20.5l1.3-4.1a8.6 8.6 0 1 1 15.7-4.8z"/><path d="M9 9.5c.3 2.4 2.2 4.4 4.9 5"/>',receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',box:'<path d="m3 7.5 9-4.5 9 4.5-9 4.5z"/><path d="M3 7.5v9l9 4.5 9-4.5v-9M12 12v9"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
let data=emptyQuote(rememberedNotes()),quoteId=crypto.randomUUID(),row=null,dirty=false,readOnly=false,scenes=[],pageIndex=0,draftTimer,previewTimer,toastTimer,showErrors=false,ready=false,canStore=true,busy=null,saving=null,session=0,clientList=[],lastClient=null;
const fieldIds=['customer','docType','document','phone','email','address','notes'];
function rememberedNotes(){try{const saved=localStorage.getItem(NOTES_KEY);if(saved!==null)return cleanText(saved).replace(/\r/g,'').slice(0,800);}catch(e){}return DEFAULT_NOTES;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
// Borradores en este dispositivo: «fresh» = la cotización nueva sin guardar; «edits» = cambios sin guardar de las ya guardadas (por id).
function readDrafts(){try{const v=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');return {fresh:v?.fresh&&typeof v.fresh==='object'?v.fresh:null,edits:v?.edits&&typeof v.edits==='object'&&!Array.isArray(v.edits)?v.edits:{}};}catch(e){return {fresh:null,edits:{}};}}
function writeDrafts(drafts){try{const ids=Object.keys(drafts.edits).sort((a,b)=>(drafts.edits[b]?.at||0)-(drafts.edits[a]?.at||0)).slice(0,20);if(!drafts.fresh&&!ids.length)localStorage.removeItem(STORAGE_KEY);else localStorage.setItem(STORAGE_KEY,JSON.stringify({fresh:drafts.fresh,edits:Object.fromEntries(ids.map(id=>[id,drafts.edits[id]]))}));canStore=true;}catch(e){canStore=false;}}
function storeDraft(){clearTimeout(draftTimer);if(readOnly)return;const drafts=readDrafts();if(!row)drafts.fresh=hasContent(data)?{quote:data,id:quoteId}:null;else if(dirty)drafts.edits[quoteId]={quote:data,number:row.number,base:row.updatedAt,at:Date.now()};else delete drafts.edits[quoteId];writeDrafts(drafts);renderStatus();}
function forgetDraft(id){const drafts=readDrafts();if(drafts.fresh?.id===id)drafts.fresh=null;delete drafts.edits[id];writeDrafts(drafts);}
function normalizeRow(r,fallbackQuote=null){
 if(!r||typeof r!=='object'||typeof r.id!=='string'||!r.id)throw Error('No se pudo abrir la cotización: datos incompletos.');
 const number=Number(r.number),quote=normalizeQuote(r.quote??fallbackQuote),converted=r.status==='converted';
 const label=typeof r.label==='string'&&r.label?r.label:Number.isSafeInteger(number)&&number>0?quoteLabel(number):'COT';
 return {id:r.id,number,label,quote,status:converted?'converted':quoteStatus(quote.validUntil).key,statusText:r.statusText||'',receiptId:r.receiptId||null,receiptLabel:r.receiptLabel||null,updatedAt:r.updatedAt||null};
}
const normalizeSafe=q=>{try{return normalizeQuote(q);}catch(e){return emptyQuote(rememberedNotes());}};
const pdfLabel=()=>row?row.label:'BORRADOR';
function currentStatus(){if(!row)return {key:'draft',text:'Sin guardar'};if(readOnly)return quoteStatus(data.validUntil,today(),true,row.receiptLabel);return quoteStatus(data.validUntil);}
function setButton(button,iconName,label){button.innerHTML=(iconName?icon(iconName):'')+escapeXML(label);}
function renderButtons(){
 const needsSave=!readOnly&&(!row||dirty),clean=!!row&&!dirty&&!readOnly,locked=!ready||!!busy,idle=id=>busy?.id!==id;
 for(const id of ['downloadBtn','downloadBottomBtn'])if(idle(id))setButton($(id),'download',needsSave?'Guardar y descargar PDF':'Descargar PDF');
 if(idle('downloadMobileBtn'))$('downloadMobileBtn').textContent=needsSave?'Guardar y PDF':'Descargar PDF';
 if(idle('shareBtn'))setButton($('shareBtn'),'share','Compartir por WhatsApp');
 if(idle('saveBtn'))setButton($('saveBtn'),clean?'check':'save',clean?'Guardada':'Guardar');
 if(idle('convertBtn'))setButton($('convertBtn'),'receipt',readOnly?'Ver boleta':'Convertir en boleta');
 if(idle('saveMobileBtn'))$('saveMobileBtn').textContent=readOnly?'Ver boleta':clean?'Guardada':'Guardar';
 document.querySelectorAll('.export-btn').forEach(b=>b.disabled=locked);
 $('saveBtn').hidden=readOnly;$('saveBtn').disabled=locked||clean;$('saveBtn').classList.toggle('is-saved',clean);
 $('saveMobileBtn').disabled=locked||clean;$('saveMobileBtn').classList.toggle('is-saved',clean);
 $('duplicateBtn').hidden=!row;
 $('finishHint').textContent=readOnly?'Esta cotización ya tiene su boleta. Para volver a cotizar estos productos, duplícala.':'«Convertir en boleta» abre la boleta con estos productos ya vinculados a tu stock. Tu stock baja recién al emitirla.';
}
function renderStatus(){
 const status=currentStatus();$('statusPill').className='status-pill '+status.key;$('statusPill').textContent=status.text;
 let dot='idle',text='Nueva cotización · aún sin guardar';
 if(saving){dot='saving';text='Guardando…';}
 else if(readOnly){dot='';text=`Convertida en la boleta ${row.receiptLabel||''} · solo lectura`;}
 else if(!row&&hasContent(data)){dot='unsaved';text=canStore?'Cambios sin guardar · borrador en este dispositivo':'Cambios sin guardar';}
 else if(row&&dirty){dot='unsaved';text='Cambios sin guardar';}
 else if(row){dot='';text='Guardada · '+row.label;}
 $('saveStatus').innerHTML=`<span class="dot ${dot}"></span>${escapeXML(text)}`;
 renderButtons();
}
function renderValidity(){
 const expired=!!row&&!readOnly&&daysBetween(today(),data.validUntil)<0;
 $('validUntilText').classList.toggle('expired',expired);
 $('validUntilText').innerHTML=expired?`Venció el <strong>${formatDate(data.validUntil)}</strong>. Duplícala para renovarla con la fecha de hoy.`:`Válida hasta el <strong>${formatDate(data.validUntil)}</strong>`;
}
function renderHeading(){
 $('quoteTitle').textContent=row?'Cotización '+row.label:'Nueva cotización';document.title=(row?row.label:'Nueva cotización')+' · AO Nexus';
 $('number').value=row?row.label:'';$('dateText').value=formatDate(data.date);
 $('readonlyBanner').hidden=!readOnly;if(readOnly)$('readonlyText').innerHTML=`<strong>Convertida en la boleta ${escapeXML(row.receiptLabel||'')}.</strong> Para cambiar precios, duplícala.`;
 renderValidity();renderStatus();
}
const DOC_FIELD={DNI:['DNI','8 dígitos',8,'numeric'],RUC:['RUC','11 dígitos',11,'numeric'],CE:['N.º de carné','Número del documento',20,'text'],PAS:['N.º de pasaporte','Número del documento',20,'text'],NONE:['Documento','No aplica',20,'text']};
function updateDocumentField(){const [label,placeholder,max,mode]=DOC_FIELD[data.docType]||DOC_FIELD.DNI;$('documentLabel').innerHTML=`${escapeXML(label)} <span class="optional">· opcional</span>`;$('document').placeholder=placeholder;$('document').maxLength=max;$('document').inputMode=mode;$('document').disabled=readOnly||data.docType==='NONE';}
// Disponibilidad de la línea según tu stock actual (solo informativa: la cotización no aparta unidades).
function stockBadge(item){
 if(!item.parts.length||readOnly)return '';
 let groups=[];try{groups=host.quoteStock?.(item.parts)||[];}catch(e){return '';}
 const stock=groups.filter(g=>g.source!=='external'&&Number.isFinite(g.inStock)),pending=groups.filter(g=>g.source==='external');
 const short=stock.filter(g=>g.quoted>g.inStock),detail=groups.map(g=>g.source==='external'?`${g.name}: a pedido (no está en tu stock)`:`${g.name}: cotizas ${g.quoted} y tienes ${g.inStock??'?'} en stock`).join('\n');
 const badge=(kind,text)=>`<span class="stock-badge ${kind}" title="${escapeXML(detail)}">${escapeXML(text)}</span>`;
 if(!stock.length)return pending.length?badge('wait','A pedido'):'';
 if(short.length)return stock.length===1&&!pending.length?badge('warn',`Cotizas ${short[0].quoted} · tienes ${short[0].inStock}`):badge('warn',short.length===1?`Falta stock: ${short[0].name}`:`Falta stock en ${short.length} productos`);
 if(pending.length)return badge('wait','En stock y a pedido');
 return badge('ok',stock.length===1?`En stock: ${stock[0].inStock}`:'Todo en stock');
}
function refreshBadges(){data.items.forEach((item,i)=>{const slot=$(`badge-${i}`);if(slot)slot.innerHTML=stockBadge(item);});}
function itemHTML(item,index){const v=k=>escapeXML(item[k]);const bundle=item.mode==='bundle'&&item.parts.length>0,n=item.parts.length;
 return `<article class="item" data-index="${index}"><div class="item-head"><span class="item-title"><span class="item-n">${String(index+1).padStart(2,'0')}</span> Producto</span><span class="item-tools"><span id="badge-${index}">${stockBadge(item)}</span><button type="button" class="delete-item" data-remove="${index}" aria-label="Eliminar producto ${index+1}">Eliminar</button></span></div><div class="item-body"><button type="button" class="btn btn-outline pick-btn" data-pick="${index}">${icon('box')}${n?`${bundle?'Componentes elegidos':'Productos elegidos'} · ${n} ${n===1?'unidad':'unidades'} · Cambiar`:'Elegir de mi stock'}</button><div class="item-desc"><div class="field"><label for="description-${index}">Descripción del producto</label><textarea id="description-${index}" data-item="description" rows="2" maxlength="350" placeholder="Ej. Ryzen 7 7800X3D o Armado y configuración">${v('description')}</textarea></div><div class="field"><label for="code-${index}">Código <span class="optional">· opcional</span></label><input id="code-${index}" data-item="code" maxlength="22" value="${v('code')}" placeholder="Ej. CPU-01"></div></div><div class="item-numbers"><div class="field"><label for="quantity-${index}">Cantidad</label><input id="quantity-${index}" data-item="quantity" inputmode="numeric" maxlength="4" value="${v('quantity')}" placeholder="1"${bundle?' readonly title="Un grupo de componentes es una computadora. Para cotizar otra, agrega otro producto."':''}></div><div class="field"><label for="unit-${index}">U. M.</label><input id="unit-${index}" data-item="unit" maxlength="5" value="${v('unit')}" placeholder="NIU" aria-label="Unidad de medida del producto ${index+1}"></div><div class="field"><label for="price-${index}">Precio unit. (S/)</label><input id="price-${index}" data-item="price" inputmode="decimal" maxlength="12" value="${v('price')}" placeholder="0.00"></div><div class="field"><label>Importe</label><output class="line-total" id="amount-${index}">S/ 0.00</output></div></div></div></article>`;}
function renderItems(){$('items').innerHTML=data.items.map(itemHTML).join('');$('itemCount').textContent=`${data.items.length} ${data.items.length===1?'PRODUCTO':'PRODUCTOS'}`;applyReadOnly();}
function applyReadOnly(){document.querySelectorAll('[data-field],[data-item],[data-remove],[data-pick]').forEach(el=>el.disabled=readOnly);document.querySelectorAll('[data-remove],[data-pick]').forEach(el=>el.hidden=readOnly);$('addBtn').disabled=readOnly;$('addBtn').hidden=readOnly;$('clientHint').hidden=readOnly||!clientList.length;updateDocumentField();}
function displayErrors(errors){document.querySelectorAll('[aria-invalid="true"]').forEach(el=>el.removeAttribute('aria-invalid'));errors.forEach(e=>$(e.id)?.setAttribute('aria-invalid','true'));$('errorBox').hidden=!errors.length;$('errorBox').innerHTML=errors.length?'<strong>Revisa estos datos:</strong><ul>'+[...new Set(errors.map(e=>e.msg))].map(m=>`<li>${escapeXML(m)}</li>`).join('')+'</ul>':'';}
function showProblem(message){$('errorBox').textContent=message;$('errorBox').hidden=false;toast(message);}
function update(){const calc=calculate(data);calc.rows.forEach((r,i)=>{if($(`amount-${i}`))$(`amount-${i}`).textContent=r.amount<=MAX_CENTS?formatMoney(r.amount):'Revisar importe';});$('total').textContent=calc.withinLimit?formatMoney(calc.total):'Revisar importes';$('words').textContent=calc.withinLimit?amountInWords(calc.total):'El total supera el límite permitido.';if(showErrors)displayErrors(validate(data));clearTimeout(previewTimer);if(ready)previewTimer=setTimeout(refreshPreview,90);}
function hydrate(){for(const id of fieldIds)$(id).value=data[id];$('validDays').value=String(data.validDays);renderItems();renderHeading();update();}
function renderPage(){if(!scenes.length)return;pageIndex=Math.max(0,Math.min(pageIndex,scenes.length-1));$('preview').classList.remove('loading');$('preview').innerHTML=sceneSVG(scenes[pageIndex],`Cotización ${pdfLabel()}, página ${pageIndex+1}`);$('pageLabel').textContent=`Página ${pageIndex+1} de ${scenes.length}`;$('prevPage').disabled=pageIndex===0;$('nextPage').disabled=pageIndex===scenes.length-1;}
function refreshPreview(){scenes=buildScenes(data,pdfLabel());renderPage();}
function markDirty(){if(readOnly)return;dirty=true;if(!row){data.date=today();data.validUntil=addDays(data.date,data.validDays);$('dateText').value=formatDate(data.date);}renderStatus();clearTimeout(draftTimer);draftTimer=setTimeout(storeDraft,250);}
// Carga un estado completo en el editor: nueva, guardada, copia o borrador recuperado.
function loadState({quote,id,saved=null,unsaved=false}){
 session++;clearTimeout(draftTimer);data=structuredClone(quote);quoteId=id;row=saved;dirty=unsaved;readOnly=row?.status==='converted';
 if(!row){data.date=today();data.validUntil=addDays(data.date,data.validDays);}
 showErrors=false;pageIndex=0;lastClient=null;displayErrors([]);$('shareStatus').hidden=true;hydrate();if(dirty||!row)storeDraft();
 document.scrollingElement?.scrollTo?.(0,0);refreshClients();
}
const blankState=()=>({quote:emptyQuote(rememberedNotes()),id:crypto.randomUUID()});
function restoreFresh(){const fresh=readDrafts().fresh;if(!fresh)return false;try{loadState({quote:normalizeQuote(fresh.quote),id:validId(fresh.id)?fresh.id:crypto.randomUUID(),unsaved:true});return true;}catch(e){return false;}}
// Lo que llama el panel: null → nueva (o la que quedó sin guardar); fila → abrirla; {duplicate:true} → copia sin número.
window.openQuote=(incoming,options)=>{
 const duplicate=options?.duplicate===true;let target=null;
 if(incoming){try{target=normalizeRow(incoming);}catch(e){toast(e.message);return false;}}
 if(dirty||!row)storeDraft();
 if(!target){
  if(!row&&hasContent(data))toast('Recuperamos la cotización que no guardaste.');
  else if(restoreFresh())toast('Recuperamos la cotización que no guardaste.');
  else loadState(blankState());
  return true;
 }
 if(duplicate){
  if(readDrafts().fresh&&!confirm(`Tienes una cotización nueva sin guardar. ¿Reemplazarla por una copia de ${target.label}?`))return false;
  loadState({quote:duplicateQuote(target.quote),id:crypto.randomUUID(),unsaved:true});toast(`Copia de ${target.label} lista, con fecha de hoy. Revisa los precios y guárdala.`);return true;
 }
 // La misma cotización que se está editando: se conservan los cambios.
 if(row&&row.id===target.id&&dirty&&!readOnly&&target.status!=='converted'&&row.updatedAt===target.updatedAt){row=target;renderHeading();refreshBadges();return true;}
 const edit=readDrafts().edits[target.id];
 if(edit&&edit.base===target.updatedAt&&target.status!=='converted'){try{loadState({quote:normalizeQuote(edit.quote),id:target.id,saved:target,unsaved:true});toast(`Recuperamos tus cambios sin guardar de ${target.label}.`);return true;}catch(e){}}
 if(edit)forgetDraft(target.id);
 loadState({quote:target.quote,id:target.id,saved:target});return true;
};
// Clientes guardados para autocompletar el nombre.
function refreshClients(){Promise.resolve().then(()=>host.clients?.()).then(list=>{clientList=Array.isArray(list)?list.filter(c=>c&&typeof c.name==='string'&&c.name.trim()):[];$('clientOptions').innerHTML=clientList.slice(0,500).map(c=>{const doc=c.document?` · ${{DNI:'DNI',RUC:'RUC',CE:'C.E.',PAS:'Pasaporte'}[c.docType]||'Doc.'} ${c.document}`:'';return `<option value="${escapeXML(c.name.trim())}" label="${escapeXML((c.name.trim()+doc).slice(0,140))}"></option>`;}).join('');$('clientHint').hidden=!clientList.length||readOnly;}).catch(()=>{});}
function fillClient(overwrite){
 const name=data.customer.trim().toLowerCase();if(!name)return;
 const client=clientList.find(c=>c.name.trim().toLowerCase()===name);if(!client||client===lastClient)return;
 if(!overwrite&&(data.document.trim()||data.email.trim()||data.address.trim()))return;lastClient=client;
 data.docType=['DNI','RUC','CE','PAS','NONE'].includes(client.docType)?client.docType:(client.document?'DNI':'NONE');data.document=data.docType==='NONE'?'':cleanText(client.document||'').slice(0,20);
 data.email=cleanText(client.email||'').slice(0,254);data.address=cleanText(client.address||'').slice(0,160).replace(/\s+/g,' ');
 for(const id of ['docType','document','email','address'])$(id).value=data[id];updateDocumentField();markDirty();update();toast(`Completamos los datos de ${client.name.trim()}.`);
}
// Guarda en tu cuenta (la primera vez se asigna el número). Devuelve la fila guardada o null.
async function saveQuote({quiet=false}={}){
 if(readOnly)return row;if(saving)return saving;if(row&&!dirty)return row;
 if(!row){data.date=today();data.validUntil=addDays(data.date,data.validDays);}
 showErrors=true;const errors=validate(data);displayErrors(errors);
 if(errors.length){const field=$(errors[0].id);field?.focus({preventScroll:true});field?.scrollIntoView({behavior:'smooth',block:'center'});toast('Revisa los datos señalados antes de guardar.');return null;}
 const snapshot=structuredClone(data),id=quoteId,current=session;
 const run=async()=>{
  try{const saved=normalizeRow(await host.save(structuredClone(snapshot),id),snapshot);
   forgetDraft(id);try{localStorage.setItem(NOTES_KEY,snapshot.notes);}catch(e){}try{host.saved?.(saved);}catch(e){}
   if(current!==session)return saved;
   row=saved;quoteId=saved.id;dirty=JSON.stringify(data)!==JSON.stringify(snapshot);readOnly=saved.status==='converted';if(dirty)storeDraft();
   renderHeading();refreshPreview();if(!quiet)toast(`Cotización ${saved.label} guardada.`);
   return saved;
  }catch(e){if(current===session)showProblem(e?.message||'No se pudo guardar la cotización. Revisa tu conexión e inténtalo otra vez.');return null;}
 };
 saving=run();renderStatus();
 try{return await saving;}finally{saving=null;renderStatus();}
}
const ensureSaved=()=>readOnly||row&&!dirty?Promise.resolve(row):saveQuote({quiet:true});
// Bloquea los botones mientras se guarda o se prepara el PDF; el botón pulsado indica qué pasa.
async function withBusy(button,label,task){if(busy||!ready)return;busy={id:button.id};button.textContent=label;renderButtons();try{return await task();}catch(e){showProblem(e?.message||'No se pudo completar la acción.');}finally{busy=null;renderButtons();}}
async function buildPDF(){const saved=await ensureSaved();if(!saved)return null;const snapshot=structuredClone(data),label=saved.label;return {snapshot,label,bytes:await generatePDF(snapshot,label)};}
function downloadPDF(e){return withBusy(e.currentTarget,readOnly||row&&!dirty?'Preparando PDF…':'Guardando…',async()=>{const pdf=await buildPDF();if(!pdf)return;download(pdf.bytes,pdfFilename(pdf.snapshot,pdf.label),'application/pdf');toast(`PDF de ${pdf.label} descargado.`);});}
function sharePDF(e){return withBusy(e.currentTarget,'Preparando…',async()=>{
 const pdf=await buildPDF();if(!pdf)return;const filename=pdfFilename(pdf.snapshot,pdf.label),text=shareText(pdf.snapshot,pdf.label);
 let file=null;try{file=new File([pdf.bytes],filename,{type:'application/pdf'});}catch(err){}
 if(file&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:`Cotización ${pdf.label}`,text});return;}catch(err){if(err?.name==='AbortError')return;}}
 // Sin compartir archivos (computadora): se descarga el PDF y se abre WhatsApp con el mensaje listo para adjuntarlo.
 download(pdf.bytes,filename,'application/pdf');const url=whatsappURL(pdf.snapshot.phone,text);window.open(url,'_blank','noopener');
 $('shareStatus').hidden=false;$('shareStatus').innerHTML=`PDF descargado: <strong>${escapeXML(filename)}</strong>. En WhatsApp${normalizePhone(pdf.snapshot.phone)?'':' elige al cliente,'} adjunta el PDF y envía el mensaje. ¿No se abrió? <a href="${escapeXML(url)}" target="_blank" rel="noopener">Abrir WhatsApp</a>`;
 toast('PDF descargado. Adjúntalo en el chat de WhatsApp.');
});}
function viewReceipt(){if(row)Promise.resolve().then(()=>host.viewReceipt(row.id)).catch(err=>toast(err?.message||'No se pudo abrir la boleta.'));}
function convertQuote(e){if(readOnly){viewReceipt();return;}return withBusy(e.currentTarget,'Guardando…',async()=>{const saved=await ensureSaved();if(!saved)return;await host.convert(saved.id);});}
// Cambios sin guardar de una cotización guardada antes de salir de ella: guardarlos o descartarlos.
async function settleEdits(action){if(!row||!dirty||readOnly)return true;if(confirm(`¿Guardar los cambios de ${row.label} antes de ${action}? Si eliges «Cancelar», se descartan.`))return !!(await withBusy($('saveBtn'),'Guardando…',()=>saveQuote()));forgetDraft(row.id);dirty=false;return true;}
function duplicateCurrent(){
 if(!row||busy)return;const fresh=readDrafts().fresh;
 if(fresh&&hasContent(normalizeSafe(fresh.quote))&&!confirm('Tienes otra cotización nueva sin guardar. ¿Reemplazarla por esta copia?'))return;
 const label=row.label,source=structuredClone(data);if(dirty)forgetDraft(row.id);
 loadState({quote:duplicateQuote(source),id:crypto.randomUUID(),unsaved:true});$('customer').focus({preventScroll:true});toast(`Copia de ${label} lista, con fecha de hoy. Revisa los precios y guárdala.`);
}
async function startNew(){
 if(busy)return;
 if(!row){if(hasContent(data)&&!confirm('¿Empezar una cotización nueva? Se descartará la que no guardaste.'))return;forgetDraft(quoteId);loadState(blankState());}
 else{if(!(await settleEdits('empezar una nueva')))return;if(restoreFresh()){toast('Recuperamos la cotización nueva que no guardaste.');return;}loadState(blankState());}
 $('customer').focus({preventScroll:true});toast('Nueva cotización lista.');
}
async function goBack(){
 if(busy)return;
 if(row&&dirty&&!readOnly){if(!(await settleEdits('volver a la lista')))return;if(dirty===false&&row)loadState({quote:normalizeSafe(row.quote),id:row.id,saved:row});}
 else if(!row)storeDraft();
 host.back();
}
async function pickProducts(index,button){
 if(readOnly||button.dataset.busy)return;button.dataset.busy='1';button.disabled=true;const current=session;
 try{const selected=await host.pickProducts(structuredClone(data.items[index]),index);if(!selected||current!==session||!data.items[index])return;
  applyPick(data.items[index],selected);renderItems();markDirty();update();
 }catch(e){toast(e?.message||'No se pudo abrir tu stock.');}finally{if(button.isConnected){delete button.dataset.busy;button.disabled=readOnly;}}
}
$('quoteForm').addEventListener('submit',e=>e.preventDefault());
$('quoteForm').addEventListener('input',e=>{
 if(readOnly)return;const el=e.target;
 if(el.dataset.field){const key=el.dataset.field;
  if(key==='validDays'){data.validDays=VALID_DAYS.includes(Number(el.value))?Number(el.value):DEFAULT_VALID_DAYS;data.validUntil=addDays(data.date,data.validDays);}
  else data[key]=cleanText(el.value);
  if(key==='docType'){if(data.docType==='NONE'){data.document='';$('document').value='';}updateDocumentField();}
 }else if(el.dataset.item){const index=Number(el.closest('[data-index]').dataset.index),item=data.items[index];item[el.dataset.item]=cleanText(el.value);if(['price','quantity'].includes(el.dataset.item)){syncParts(item);const slot=$(`badge-${index}`);if(slot)slot.innerHTML=stockBadge(item);}}
 else return;
 markDirty();renderValidity();update();
 // Elegir un cliente de la lista completa su documento, correo y dirección.
 if(el.id==='customer'&&(!e.inputType||e.inputType==='insertReplacementText'))fillClient(true);
});
$('customer').addEventListener('change',()=>fillClient(false));
$('customer').addEventListener('focus',()=>{if(!clientList.length)refreshClients();});
$('items').addEventListener('click',e=>{
 const pick=e.target.closest('[data-pick]');if(pick){pickProducts(Number(pick.dataset.pick),pick);return;}
 const b=e.target.closest('[data-remove]');if(!b||readOnly)return;const index=Number(b.dataset.remove),item=data.items[index];
 if((item.description.trim()||item.price.trim()||item.parts.length)&&!confirm('¿Eliminar este producto de la cotización?'))return;
 data.items.splice(index,1);if(!data.items.length)data.items.push(newItem());renderItems();markDirty();update();
});
$('addBtn').addEventListener('click',()=>{if(readOnly)return;if(data.items.length>=MAX_ITEMS){toast('Puedes incluir hasta 100 productos por cotización.');return;}data.items.push(newItem());renderItems();markDirty();update();$(`description-${data.items.length-1}`).focus();});
$('newBtn').addEventListener('click',startNew);
$('duplicateBtn').addEventListener('click',duplicateCurrent);$('bannerDuplicateBtn').addEventListener('click',duplicateCurrent);
$('bannerReceiptBtn').addEventListener('click',viewReceipt);
$('backBtn').addEventListener('click',goBack);
for(const id of ['downloadBtn','downloadBottomBtn','downloadMobileBtn'])$(id).addEventListener('click',downloadPDF);
for(const id of ['shareBtn','shareMobileBtn'])$(id).addEventListener('click',sharePDF);
$('saveBtn').addEventListener('click',e=>withBusy(e.currentTarget,'Guardando…',()=>saveQuote()));
$('saveMobileBtn').addEventListener('click',e=>readOnly?viewReceipt():withBusy(e.currentTarget,'Guardando…',()=>saveQuote()));
$('convertBtn').addEventListener('click',convertQuote);
$('prevPage').addEventListener('click',()=>{pageIndex--;renderPage();});$('nextPage').addEventListener('click',()=>{pageIndex++;renderPage();});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='s'){e.preventDefault();if(!readOnly)withBusy($('saveBtn'),'Guardando…',()=>saveQuote());}});
window.addEventListener('pagehide',()=>{if(dirty||!row)storeDraft();});
window.addEventListener('focus',refreshBadges);
try{localStorage.setItem(STORAGE_KEY+'-check','1');localStorage.removeItem(STORAGE_KEY+'-check');}catch(e){canStore=false;}
// Al abrir se recupera la cotización nueva que quedó sin guardar en este dispositivo (si la hay).
if(!restoreFresh())loadState(blankState());
async function init(){try{const scratch=await PDFLib.PDFDocument.create();fonts=await embedQuoteFonts(scratch);await loadPreviewFonts();ready=true;refreshPreview();renderButtons();if(showErrors)displayErrors(validate(data));}catch(e){$('preview').innerHTML='<div class="initial-error">No se pudo preparar el PDF. Recarga la página e inténtalo otra vez en Chrome o Edge.</div>';console.error(e);}}
init();
try{host.frameReady?.();}catch(e){}

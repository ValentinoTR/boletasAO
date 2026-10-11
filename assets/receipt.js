const cloud = window.parent !== window && window.parent.AOCloud;
if (!cloud) { location.replace('./'); throw Error('Abre el generador desde tu cuenta de AO Nexus.'); }
let cloudReceiptId=crypto.randomUUID(), viewingIssued=false;
const receiptAssetCache=new Map();
async function receiptBytes(url){if(!receiptAssetCache.has(url))receiptAssetCache.set(url,fetch(url).then(async r=>{if(!r.ok)throw Error('No se pudo cargar un recurso del PDF.');return new Uint8Array(await r.arrayBuffer());}).catch(e=>{receiptAssetCache.delete(url);throw e;}));return receiptAssetCache.get(url);}

'use strict';
const TEMPLATE = 'assets/receipt-template.png';
const FONT_REGULAR = 'assets/receipt-regular.ttf';
const FONT_BOLD = 'assets/receipt-bold.ttf';
const FONT_ITALIC = 'assets/receipt-italic.ttf';
async function embedReceiptFonts(doc){doc.registerFontkit(fontkit);return {regular:await doc.embedFont(await receiptBytes(FONT_REGULAR),{subset:true}),bold:await doc.embedFont(await receiptBytes(FONT_BOLD),{subset:true}),italic:await doc.embedFont(await receiptBytes(FONT_ITALIC),{subset:true})};}
async function loadPreviewFonts(){const definitions=[[FONT_REGULAR,'normal','400'],[FONT_BOLD,'normal','700'],[FONT_ITALIC,'italic','400']];await Promise.all(definitions.map(async([url,style,weight])=>{const face=new FontFace('AOReceipt',`url(${url})`,{style,weight});await face.load();document.fonts.add(face);}));}
const STORAGE_KEY = 'ao-nexus-boleta-v1-'+cloud.userId;
const VERSION = 1, MAX_CENTS = 99999999999, MAX_ITEMS = 100;
const PAGE_W = 595.5, PAGE_H = 842.25;
const $ = id => document.getElementById(id);
const escapeXML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanText = s => String(s??'').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/[\u200b-\u200d\ufeff]/g,'');
function today(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>parts.find(p=>p.type===t).value;return `${get('year')}-${get('month')}-${get('day')}`;}
function newItem(){return {description:'',serial:'',code:'',unit:'NIU',quantity:'1',price:'',inventory:[]};}
function emptyReceipt(number='110',series='B001',observations='1 AÑO DE GARANTÍA.'){return {version:VERSION,series,number,date:today(),customer:'',docType:'DNI',document:'',address:'',email:'',observations,items:[newItem()]};}
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
function calculate(data){let total=0;const rows=data.items.map(item=>{const qty=quantityFromInput(item.quantity),price=centsFromInput(item.price);const amount=qty!==null&&price!==null?qty*price:0;total+=amount;return {...item,qty,priceCents:price,amount};});return {total,rows,withinLimit:Number.isSafeInteger(total)&&total<=MAX_CENTS};}
function normalizeData(input){
 if(!input||typeof input!=='object'||input.version!==VERSION||!Array.isArray(input.items)||input.items.length<1||input.items.length>MAX_ITEMS)throw Error('El archivo no es una copia válida de este generador.');
 const base=emptyReceipt();for(const [key,max] of Object.entries({series:8,number:10,date:10,customer:110,docType:4,document:20,address:160,email:254,observations:800}))base[key]=cleanText(input[key]??base[key]).slice(0,max).replace(key==='observations'?/\r/g:/\s+/g,key==='observations'?'':' ');
 if(!['DNI','RUC','CE','PAS','NONE'].includes(base.docType))base.docType='DNI';
 base.items=input.items.map(item=>{if(!item||typeof item!=='object')throw Error('La copia contiene productos inválidos.');const it=newItem();for(const [key,max] of Object.entries({description:350,serial:140,code:22,unit:5,quantity:4,price:12}))it[key]=cleanText(item[key]??it[key]).slice(0,max).replace(/\s+/g,' ');it.inventory=Array.isArray(item.inventory)?structuredClone(item.inventory):[];it.inventoryMode=item.inventoryMode==="bundle"?"bundle":"units";return it;});return base;
}
let data=emptyReceipt(),fonts=null,scenes=[],pageIndex=0,saveTimer,previewTimer,toastTimer,showErrors=false,ready=false,canStore=true;
try{const saved=localStorage.getItem(STORAGE_KEY);if(saved){const parsed=JSON.parse(saved);data=normalizeData(parsed.receipt||parsed);if(parsed.id){cloudReceiptId=parsed.id;viewingIssued=parsed.issued===true;}}}catch(e){canStore=false;}
// Al abrir el generador, la fecha del borrador se renueva con el día local del equipo.
let lastDateCheck=today();
if(!viewingIssued)data.date=lastDateCheck;
const fieldIds=['series','number','date','customer','docType','document','address','email','observations'];
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function saveDraft(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({receipt:data,id:cloudReceiptId,issued:viewingIssued}));canStore=true;$('saveStatus').textContent=viewingIssued?'Boleta guardada en la nube':'Borrador en este dispositivo · la venta se registra al emitir la boleta';}catch(e){canStore=false;$('saveStatus').textContent='Usa Guardar copia para conservar tu boleta';}}
function queueSave(){clearTimeout(saveTimer);$('saveStatus').textContent=canStore?'Guardando borrador…':'Usa Guardar copia para conservar tu boleta';saveTimer=setTimeout(saveDraft,250);}
function updateDocumentField(){const type=data.docType;const config={DNI:['DNI del cliente','8 dígitos',8,'numeric'],RUC:['RUC del cliente','11 dígitos',11,'numeric'],CE:['N.º de carné','Número del documento',20,'text'],PAS:['N.º de pasaporte','Número del documento',20,'text'],NONE:['Documento','No aplica',20,'text']}[type];$('documentLabel').textContent=config[0];$('document').placeholder=config[1];$('document').maxLength=config[2];$('document').inputMode=config[3];$('document').disabled=type==='NONE';}
function hydrate(){copyWarning='';for(const id of fieldIds)$(id).value=data[id];updateDocumentField();renderItems();$('sendEmail').checked=false;pendingDelivery=null;$('emailDeliveryStatus').hidden=true;updateEmailButtons();update();lockIssuedFields();}
function syncReceiptDate(){
 if(viewingIssued)return;
 const currentDay=today();
 if(currentDay===lastDateCheck)return;
 lastDateCheck=currentDay;data.date=currentDay;$('date').value=currentDay;
 update();saveDraft();
}
function itemHTML(item,index){const v=k=>escapeXML(item[k]);return `<article class="item" data-index="${index}"><div class="item-head"><span class="item-title"><span class="item-n">${String(index+1).padStart(2,'0')}</span> Producto</span><button type="button" class="delete-item" data-remove="${index}" aria-label="Eliminar producto ${index+1}">Eliminar</button></div><div class="item-body"><button type="button" class="btn btn-outline" data-inventory="${index}">${item.inventory?.length?`Productos seleccionados · ${item.inventory.length} unidad(es)`:"Seleccionar productos para esta venta"}</button><div class="field"><label for="description-${index}">Descripción del producto</label><textarea id="description-${index}" data-item="description" rows="2" maxlength="350" placeholder="Ej. SSD NVMe 1 TB">${v('description')}</textarea></div><div class="item-details"><div class="field"><label for="code-${index}">Código <span class="optional">· opcional</span></label><input id="code-${index}" data-item="code" maxlength="22" value="${v('code')}" placeholder="Ej. SSD-01"></div><div class="field"><label for="serial-${index}">N.º de serie <span class="optional">· opcional</span></label><input id="serial-${index}" data-item="serial" maxlength="140" value="${v('serial')}" placeholder="S/N del producto"></div></div><div class="item-numbers"><div class="field"><label for="quantity-${index}">Cantidad</label><input id="quantity-${index}" data-item="quantity" inputmode="numeric" maxlength="4" value="${v('quantity')}" placeholder="1"></div><div class="field"><label for="unit-${index}">U. M.</label><input id="unit-${index}" data-item="unit" maxlength="5" value="${v('unit')}" placeholder="NIU" aria-label="Unidad de medida del producto ${index+1}"></div><div class="field"><label for="price-${index}">Precio unit. (S/)</label><input id="price-${index}" data-item="price" inputmode="decimal" maxlength="12" value="${v('price')}" placeholder="0.00"></div><div class="field"><label>Importe</label><output class="line-total" id="amount-${index}">S/ 0.00</output></div></div></div></article>`;}
function renderItems(){$('items').innerHTML=data.items.map(itemHTML).join('');$('itemCount').textContent=`${data.items.length} ${data.items.length===1?'PRODUCTO':'PRODUCTOS'}`;}
function validate(){const errors=[];const fail=(id,msg)=>errors.push({id,msg});if(!/^[A-Za-z0-9]{1,8}$/.test(data.series.trim()))fail('series','Ingresa una serie de hasta 8 letras o números.');if(!/^\d{1,10}$/.test(data.number)||Number(data.number)<1)fail('number','Ingresa un número de boleta mayor que cero (hasta 10 dígitos).');const dateParts=data.date.split('-').map(Number),parsed=new Date(data.date+'T12:00:00');if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||!Number.isFinite(parsed.getTime())||parsed.getFullYear()!==dateParts[0]||parsed.getMonth()+1!==dateParts[1]||parsed.getDate()!==dateParts[2])fail('date','Selecciona una fecha válida.');if(!data.customer.trim())fail('customer','Completa el nombre del cliente.');if(data.docType==='DNI'&&!/^\d{8}$/.test(data.document))fail('document','El DNI debe contener 8 dígitos, o selecciona Sin documento.');if(data.docType==='RUC'&&!/^\d{11}$/.test(data.document))fail('document','El RUC debe contener 11 dígitos.');if(['CE','PAS'].includes(data.docType)&&!data.document.trim())fail('document','Completa el número del documento.');data.items.forEach((item,i)=>{if(!item.description.trim())fail(`description-${i}`,`Producto ${i+1}: completa la descripción.`);if(quantityFromInput(item.quantity)===null)fail(`quantity-${i}`,`Producto ${i+1}: la cantidad debe ser un entero entre 1 y 9999.`);if(!viewingIssued){if(!item.inventory?.length)fail(`description-${i}`,`Producto ${i+1}: elige su stock o compra externa.`);else if(item.inventoryMode!=="bundle"&&quantityFromInput(item.quantity)!==item.inventory.length)fail(`quantity-${i}`,`Producto ${i+1}: selecciona una unidad de stock por cada unidad vendida.`);else if(item.inventoryMode==="bundle"&&item.quantity!=="1")fail(`quantity-${i}`,`Producto ${i+1}: cada grupo de componentes corresponde a una computadora.`);}if(centsFromInput(item.price)===null)fail(`price-${i}`,`Producto ${i+1}: ingresa un precio válido, sin separadores de miles y con hasta 2 decimales.`);if(!item.unit.trim())fail(`unit-${i}`,`Producto ${i+1}: completa la unidad de medida (por ejemplo, NIU).`);});if(wrapText(data.observations.trim().replace(/\n\s*\n/g,'\n'),435,9.4).length>16)fail('observations','Acorta las observaciones a un máximo de 16 líneas.');const calc=calculate(data);if(!calc.withinLimit)fail('total','El importe total no puede superar S/ 999,999,999.99.');
 if(fonts){const texts=[data.customer,data.address,data.observations,data.document,...data.items.flatMap(i=>[i.description,i.serial,i.code,i.unit])];try{const supported=new Set(fonts.regular.getCharacterSet());texts.forEach(t=>{for(const ch of t.replace(/\n|\r|\t/g,' '))if(!supported.has(ch.codePointAt(0)))throw Error('Unsupported character');});}catch(e){fail('customer','Hay un símbolo que no se puede incluir en el PDF. Retira emojis o caracteres de otros alfabetos. Las tildes y la ñ sí están permitidas.');}}
 return errors;
}
function displayErrors(errors){document.querySelectorAll('[aria-invalid="true"]').forEach(el=>el.removeAttribute('aria-invalid'));errors.forEach(e=>$(e.id)?.setAttribute('aria-invalid','true'));$('errorBox').hidden=!errors.length;$('errorBox').textContent=errors.map(e=>e.msg).join(' ');}
function update(){const calc=calculate(data);calc.rows.forEach((row,i)=>{if($(`amount-${i}`))$(`amount-${i}`).textContent=row.amount<=MAX_CENTS?formatMoney(row.amount):'Revisar importe';});$('total').textContent=calc.withinLimit?formatMoney(calc.total):'Revisar importes';$('words').textContent=calc.withinLimit?amountInWords(calc.total):'El total supera el límite permitido.';if(showErrors)displayErrors(validate());clearTimeout(previewTimer);if(ready)previewTimer=setTimeout(refreshPreview,90);}
function safeWidth(text,size,font='regular'){try{return fonts[font].widthOfTextAtSize(text,size);}catch(e){return [...text].length*size*.56;}}
function wrapText(text,width,size,font='regular'){const lines=[];for(const paragraph of cleanText(text).replace(/\r/g,'').split('\n')){let line='';for(const word of paragraph.split(/\s+/).filter(Boolean)){const test=line?line+' '+word:word;if(safeWidth(test,size,font)<=width){line=test;continue;}if(line){lines.push(line);line='';}if(safeWidth(word,size,font)<=width){line=word;continue;}let part='';for(const char of word){if(part&&safeWidth(part+char,size,font)>width){lines.push(part);part='';}part+=char;}line=part;}lines.push(line);}return lines.length?lines:[''];}
function fittedLines(text,width,size,minSize,maxLines,font='regular'){let lines=wrapText(text,width,size,font);while(lines.length>maxLines&&size>minSize){size=Math.max(minSize,size-.2);lines=wrapText(text,width,size,font);}return {lines,size};}
function buildScenes(d){
 const calc=calculate(d),groups=[];let rows=[],used=0;for(const [i,row] of calc.rows.entries()){let descSize=7.7,serialSize=7.3,lineHeight=10,serialLineHeight=9.5;let lines=wrapText((row.description||' ').replace(/\s+/g,' '),223,descSize),serialLines=row.serial.trim()?wrapText(('S/N: '+row.serial).replace(/\s+/g,' '),223,serialSize):[];const codeLines=wrapText(row.code||String(i+1),44,8.4);let height=Math.max(26,lines.length*lineHeight+serialLines.length*serialLineHeight+10,codeLines.length*9.5+10);if(height>165){descSize=7;serialSize=6.8;lineHeight=9;serialLineHeight=8.8;lines=wrapText((row.description||' ').replace(/\s+/g,' '),223,descSize);serialLines=row.serial.trim()?wrapText(('S/N: '+row.serial).replace(/\s+/g,' '),223,serialSize):[];height=Math.max(26,lines.length*lineHeight+serialLines.length*serialLineHeight+10,codeLines.length*9.5+10);}if(rows.length&&used+height>165){groups.push(rows);rows=[];used=0;}rows.push({...row,i,lines,serialLines,height,descSize,serialSize,lineHeight,serialLineHeight});used+=height;}if(rows.length)groups.push(rows);
 return groups.map((group,pi)=>{const ops=[];const rect=(x,y,w,h,fill='#ffffff',stroke=null,lineWidth=.7)=>ops.push({type:'rect',x,y,w,h,fill,stroke,lineWidth});const text=(value,x,y,size=10,font='regular',color='#000000',align='left')=>{value=String(value);let tx=x;if(align==='center')tx-=safeWidth(value,size,font)/2;if(align==='right')tx-=safeWidth(value,size,font);ops.push({type:'text',value,x:tx,y,size,font,color});};const fitText=(value,x,y,width,size=9.5,font='regular',align='left')=>{while(safeWidth(String(value),size,font)>width&&size>5.2)size-=.2;text(String(value).replace(/\s+/g,' '),x,y,size,font,'#000000',align);};
 // Preserve the exact artwork from the supplied PDF, replacing variable regions.
 rect(393.7,63.6,172.8,116.9,'#ffffff','#252525',1);
 text('BOLETA',480.1,105,16,'regular','#101010','center');text('ELECTRÓNICA',480.1,125,16,'regular','#101010','center');fitText(`${d.series.toUpperCase()}-${d.number}`,480.1,141.2,157,10,'bold','center');
 text('AO Nexus',290.5,89.7,10,'bold','#000000','center');['VENTA DE COMPUTADORAS,','COMPONENTES Y ACCESORIOS','Contacto: 936 177 329','Av. Inca Garcilaso de la Vega 1348','Tienda 2B-147','Centro de Lima'].forEach((v,i)=>text(v,290.5,103.2+i*13.5,10,'italic','#000000','center'));
 text('CLIENTE:',48,227,10,'bold');const name=fittedLines((d.customer||' ').replace(/\s+/g,' '),318,10,5.8,2);name.lines.forEach((v,i)=>text(v,111.8,227+i*11,name.size));text('DIRECCIÓN:',48,249.5,10,'bold');const addr=fittedLines((d.address.trim()||'SIN DIRECCIÓN').replace(/\s+/g,' '),313,10,6,3);addr.lines.forEach((v,i)=>text(v,116,249.5+i*10.5,addr.size));const currencyY=Math.max(272,249.5+(addr.lines.length-1)*10.5+15);text('MONEDA:',48,currencyY,10,'bold');text('SOLES',111.8,currencyY,10);
 const docLabel={DNI:'L.E/DNI:',RUC:'RUC:',CE:'C.E.:',PAS:'PASAP.:',NONE:'DOC.:'}[d.docType];text(docLabel,438.8,227,10,'bold');fitText(d.docType==='NONE'?'—':d.document,484.8,227,78,10);text('FECHA:',438.8,249.5,10,'bold');const f=d.date.split('-');text(f.length===3?`${f[2]}/${f[1]}/${f[0].slice(-2)}`:'',484.8,249.5,10);
 let y=322;for(const row of group){fitText(row.i+1,52.8,y+10,23,9,'regular','center');fitText(row.quantity,90.8,y+10,38,9,'regular','center');fitText(row.unit,137,y+10,36,9,'regular','center');const code=fittedLines(row.code||String(row.i+1),44,8.4,6.5,3);code.lines.forEach((v,i)=>text(v,184.8,y+10+i*9.5,code.size,'regular','#000000','center'));row.lines.forEach((v,i)=>text(v,211.8,y+10+i*row.lineHeight,row.descSize));row.serialLines.forEach((v,i)=>text(v,211.8,y+10+row.lines.length*row.lineHeight+i*row.serialLineHeight,row.serialSize));fitText(row.priceCents===null?'':formatMoney(row.priceCents),496,y+10,50,8.5,'regular','right');fitText(row.amount<=MAX_CENTS?formatMoney(row.amount):'—',556.6,y+10,52,8.5,'regular','right');y+=row.height;}
 // Footer is rebuilt to wrap long amounts and observations without clipping.
 rect(29,497,538,120,'#ffffff');const final=pi===groups.length-1;const words=final?(calc.withinLimit?amountInWords(calc.total):'REVISAR IMPORTE'):'CONTINÚA EN LA SIGUIENTE PÁGINA';text('SON:',38,517,8.2,'bold');const wordLines=wrapText(words,316,9.4);wordLines.forEach((v,i)=>text(v,64.3,517+i*11.5,9.4));text(final?'IMPORTE TOTAL':'SUBTOTAL PÁGINA',391,517,8.1,'bold');fitText(formatMoney(final?(calc.withinLimit?calc.total:0):group.reduce((s,r)=>s+r.amount,0)),566.5,517,85,10,'regular','right');
 const obsY=Math.max(535,517+(wordLines.length-1)*11.5+17);const obs=final?d.observations:'La venta continúa en la siguiente página.';const allObsLines=wrapText(obs.trim().replace(/\n\s*\n/g,'\n'),435,9.4);const obsLines=allObsLines.length>16?[...allObsLines.slice(0,15),'[Acorta las observaciones antes de exportar]']:allObsLines;const boxHeight=Math.max(56,25+obsLines.length*12);rect(31,obsY,532,boxHeight,'#ffffff','#7035b2',.8);text('OBSERVACIONES:',39,obsY+18,8.2,'bold');obsLines.forEach((v,i)=>text(v,118,obsY+18+i*12,9.4));if(groups.length>1)text(`Página ${pi+1} de ${groups.length}`,566,813,8,'regular','#777777','right');return ops;});
}
function sceneSVG(ops){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" role="img" aria-label="Boleta ${escapeXML(data.series+'-'+data.number)}, página ${pageIndex+1}"><rect width="100%" height="100%" fill="white"/><image href="${TEMPLATE}" x="3.337059" y="4.25354" width="593.47363" height="838.065735"/>`+ops.map(o=>o.type==='rect'?`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${o.fill}"${o.stroke?` stroke="${o.stroke}" stroke-width="${o.lineWidth}"`:''}/>`:`<text x="${o.x}" y="${o.y}" font-family="AOReceipt, Arial, Helvetica, sans-serif" font-size="${o.size}" font-weight="${o.font==='bold'?'700':'400'}" font-style="${o.font==='italic'?'italic':'normal'}" fill="${o.color}">${escapeXML(o.value)}</text>`).join('')+'</svg>';}
function renderPage(){if(!scenes.length)return;pageIndex=Math.max(0,Math.min(pageIndex,scenes.length-1));$('preview').classList.remove('loading');$('preview').innerHTML=sceneSVG(scenes[pageIndex]);$('pageLabel').textContent=`Página ${pageIndex+1} de ${scenes.length}`;$('prevPage').disabled=pageIndex===0;$('nextPage').disabled=pageIndex===scenes.length-1;}
function refreshPreview(){scenes=buildScenes(data);renderPage();}
function rgbHex(hex){return PDFLib.rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);}
async function generatePDF(d){const doc=await PDFLib.PDFDocument.create();const docFonts=await embedReceiptFonts(doc);const bg=await doc.embedPng(await receiptBytes(TEMPLATE));const layouts=buildScenes(d);doc.setTitle(`Boleta ${d.series.toUpperCase()}-${d.number} · AO Nexus`);doc.setAuthor('AO Nexus');doc.setCreator('AO Nexus · Gestor de boletas');doc.setSubject('Boleta de venta');for(const ops of layouts){const p=doc.addPage([PAGE_W,PAGE_H]);p.drawImage(bg,{x:3.337059,y:PAGE_H-4.25354-838.065735,width:593.47363,height:838.065735});for(const o of ops){if(o.type==='rect')p.drawRectangle({x:o.x,y:PAGE_H-o.y-o.h,width:o.w,height:o.h,color:rgbHex(o.fill),...(o.stroke?{borderColor:rgbHex(o.stroke),borderWidth:o.lineWidth}:{})});else p.drawText(o.value,{x:o.x,y:PAGE_H-o.y,size:o.size,font:docFonts[o.font],color:rgbHex(o.color)});}}return doc.save();}
function download(bytes,filename,mime){const blob=new Blob([bytes],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function filename(ext,d=data){const name=(d.customer||'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9 _-]/g,'').trim().replace(/\s+/g,'-').slice(0,45);return `Boleta-${d.series.toUpperCase()}-${d.number}-${name||'cliente'}.${ext}`;}
async function exportPDF(){
 if(!ready||exporting)return;syncReceiptDate();clearTimeout(saveTimer);showErrors=true;
 const errors=validate();if($('sendEmail').checked&&!validEmail(data.email))errors.push({id:'email',msg:'Ingresa un correo válido para enviar, o desmarca el envío por correo.'});
 displayErrors(errors);if(errors.length){const field=$(errors[0].id);field?.focus();field?.scrollIntoView({behavior:'smooth',block:'center'});toast('Revisa los datos señalados antes de exportar.');return;}
 let snapshot=structuredClone(data);const sendRequested=$('sendEmail').checked;exporting=true;
 document.querySelectorAll('.export-btn').forEach(b=>{b.disabled=true;b.textContent='Guardando boleta…';});$('retryEmailBtn').disabled=true;
 try{
  if(!viewingIssued){const saved=await cloud.issue(cloudReceiptId,snapshot);data=normalizeData(saved.payload);cloudReceiptId=saved.id;viewingIssued=true;autoAdvanceId=saved.id;hydrate();$('sendEmail').checked=sendRequested;snapshot=structuredClone(data);saveDraft();cloud.saved();}
  const issuedId=cloudReceiptId;
  await cloud.ensureReceiptAvailable(issuedId);
  const bytes=await generatePDF(snapshot);
  if(cloudReceiptId!==issuedId||!viewingIssued)throw Error('La boleta fue eliminada o cambió durante la descarga. Actualiza el historial.');
  download(bytes,filename('pdf',snapshot),'application/pdf');saveDraft();
  try{await cloud.upload(issuedId,bytes);}catch(e){copyWarning='No se pudo guardar la copia del PDF en la nube; puedes volver a exportarla desde el historial.';deliveryMessage('Boleta guardada y PDF descargado.',true,false);}
  if(cloudReceiptId!==issuedId||!viewingIssued)throw Error('La boleta fue eliminada. Crea una nueva con los datos correctos.');
  if(sendRequested){pendingDelivery={requestId:crypto.randomUUID(),to:snapshot.email.trim(),customer:snapshot.customer,series:snapshot.series.toUpperCase(),number:snapshot.number,date:snapshot.date,total:formatMoney(calculate(snapshot).total),filename:filename('pdf',snapshot),pdfBase64:bytesToBase64(bytes)};if(await deliverPendingEmail())startNextReceipt('emitida y enviada');}
  else{toast('Boleta guardada en la nube. PDF descargado para compartir.');startNextReceipt('emitida y guardada');}
 }catch(e){$('errorBox').textContent=e.message||'No se pudo guardar la boleta. Revisa tu conexión e inténtalo otra vez.';$('errorBox').hidden=false;toast($('errorBox').textContent);$('errorBox').scrollIntoView({behavior:'smooth',block:'center'});}
 finally{exporting=false;document.querySelectorAll('.export-btn').forEach(b=>b.disabled=!ready);$('retryEmailBtn').disabled=false;updateEmailButtons();}
}

function hasContent(){return !!(data.customer.trim()||data.document.trim()||data.email.trim()||data.items.some(i=>i.description.trim()||i.price.trim()||i.serial.trim()||i.code.trim()));}
function resetErrors(){showErrors=false;displayErrors([]);pageIndex=0;}

let emailService={available:false,configured:false,token:'',sender:''},pendingDelivery=null,exporting=false,autoAdvanceId=null,copyWarning='';
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$/.test(value.trim());
function bytesToBase64(bytes){let out='';for(let offset=0;offset<bytes.length;offset+=32768)out+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(out);}
function updateEmailButtons(){if(exporting)return;const label=viewingIssued?($('sendEmail').checked?'Descargar y enviar':'Descargar PDF'):($('sendEmail').checked?'Emitir y enviar':'Emitir y descargar');$('exportBtn').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m-5-5 5 5 5-5M5 15v5h14v-5"/></svg>'+label;$('exportMobileBtn').textContent=label;}
function deliveryMessage(message,problem=false,retry=false){$('emailDeliveryMessage').textContent=message+(copyWarning&&!message.includes(copyWarning)?' '+copyWarning:'');if(copyWarning)problem=true;$('emailDeliveryStatus').hidden=false;$('emailDeliveryStatus').classList.toggle('problem',problem);$('retryEmailBtn').hidden=!retry;}
async function emailAPI(path,payload){
 const action=path.split('/').pop();
 if(action==='send')return cloud.api('send',{job:payload,receiptId:cloudReceiptId});
 if(action==='settings')return cloud.api('settings',{settings:payload});
 return cloud.api(action);
}

async function initEmailService(){
 $('emailSettingsBtn').hidden=true;
 if(!['https:','http:'].includes(location.protocol)){$('emailConnection').textContent='Abre el enlace web para usar el correo de la empresa.';return;}
 try{
  const config=await emailAPI('/api/email-config');emailService={available:true,configured:config.configured,token:config.token,sender:config.sender};
  $('emailConnection').textContent=config.configured?'Enviar desde '+config.sender:'Correo pendiente de activar por el administrador';
  $('emailSettingsBtn').hidden=!config.admin;$('disconnectEmailBtn').hidden=!config.configured;$('connectEmailBtn').disabled=false;
 }catch(e){$('emailConnection').textContent='Correo temporalmente no disponible';}
}
async function deliverPendingEmail(){
 if(!pendingDelivery)return;
 if(!emailService.available||!emailService.configured){deliveryMessage('PDF descargado. El administrador debe activar el correo de la empresa para enviarlo a '+pendingDelivery.to+'. Después pulsa Reintentar envío.',true,true);toast('PDF descargado. Falta conectar el correo de la empresa.');return;}
 const job=pendingDelivery;deliveryMessage('PDF descargado. Enviando la boleta a '+job.to+'…');
 try{await emailAPI('/api/send',job);deliveryMessage('Boleta '+job.series+'-'+job.number+' enviada a '+job.to+' desde '+emailService.sender+'. El PDF también quedó descargado.');if(pendingDelivery===job)pendingDelivery=null;toast('PDF descargado y correo enviado.');return true;}
 catch(e){const uncertain=e.code==='delivery_unknown';deliveryMessage('PDF descargado. '+e.message, true,!uncertain);toast(uncertain?'Comprueba la recepción antes de volver a exportar.':'El PDF está descargado; el correo sigue pendiente.');}
 return false;
}
// Tras emitir una boleta nueva (y enviarla, si se pidió) se abre la siguiente con el número que sigue.
async function startNextReceipt(outcome){
 if(!autoAdvanceId||autoAdvanceId!==cloudReceiptId||!viewingIssued)return;
 const done='Boleta '+data.series.toUpperCase()+'-'+data.number+' '+outcome+'.';
 const status={shown:!$('emailDeliveryStatus').hidden,text:$('emailDeliveryMessage').textContent,problem:$('emailDeliveryStatus').classList.contains('problem')};
 // Mientras la base confirma el número, se muestra el siguiente al recién emitido (la base asigna el definitivo al emitir).
 const expected=/^\d{1,10}$/.test(data.number)?String(Number(data.number)+1):'110';
 autoAdvanceId=null;pendingDelivery=null;viewingIssued=false;cloudReceiptId=crypto.randomUUID();
 data=emptyReceipt(expected,data.series.toUpperCase(),data.observations);
 resetErrors();hydrate();saveDraft();
 // El resultado de la boleta anterior (por ejemplo, que no se guardó su copia en la nube) sigue a la vista.
 if(status.shown)deliveryMessage(status.text,status.problem,false);
 // El número se consulta sin retener los botones de exportación (quien llama no espera esta función).
 const numbered=await refreshCloudNumber();
 toast(done+(numbered?' Nueva boleta lista: '+data.series.toUpperCase()+'-'+data.number+'.':' Nueva boleta lista; su número se asignará al emitir.'));
}
$('sendEmail').addEventListener('change',()=>{updateEmailButtons();if($('sendEmail').checked&&!data.email.trim())$('email').focus();});
$('emailSettingsBtn').addEventListener('click',()=>{$('mailerSecret').value='';$('emailSettingsMessage').textContent='';$('emailSettingsDialog').showModal();});
$('closeEmailSettingsBtn').addEventListener('click',()=>{$('mailerSecret').value='';$('emailSettingsDialog').close();});
$('emailSettingsDialog').addEventListener('close',()=>{$('mailerSecret').value='';});
$('emailSettingsForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!emailService.available)return;
 const button=$('connectEmailBtn');button.disabled=true;button.textContent='Verificando conexión…';$('emailSettingsMessage').classList.remove('success');$('emailSettingsMessage').textContent='';
 const settings={url:$('mailerURL').value.trim(),secret:$('mailerSecret').value.trim()};$('mailerSecret').value='';
 try{await emailAPI('/api/settings',settings);await initEmailService();$('emailSettingsMessage').classList.add('success');$('emailSettingsMessage').textContent='Correo conectado para todos los usuarios con acceso. Ya pueden enviar sus boletas.';}
 catch(err){$('emailSettingsMessage').textContent=err.message;}
 finally{settings.secret='';button.disabled=false;button.textContent='Guardar y conectar';}
});
$('disconnectEmailBtn').addEventListener('click',async()=>{const button=$('disconnectEmailBtn');button.disabled=true;try{await emailAPI('/api/disconnect',{});await initEmailService();$('emailSettingsMessage').textContent='Correo desconectado para todos los usuarios.';}catch(err){$('emailSettingsMessage').textContent=err.message;}finally{button.disabled=false;}});
$('retryEmailBtn').addEventListener('click',async()=>{if(exporting)return;exporting=true;$('retryEmailBtn').disabled=true;document.querySelectorAll('.export-btn').forEach(b=>b.disabled=true);try{if(await deliverPendingEmail())startNextReceipt('emitida y enviada');}finally{exporting=false;$('retryEmailBtn').disabled=false;document.querySelectorAll('.export-btn').forEach(b=>b.disabled=!ready);updateEmailButtons();}});
$('receiptForm').addEventListener('submit',e=>e.preventDefault());
$('receiptForm').addEventListener('input',e=>{const el=e.target;if(el.dataset.field){data[el.dataset.field]=cleanText(el.value);if(el.id==='docType')updateDocumentField();if(el.id==='series')refreshCloudNumber();}else if(el.dataset.item){const index=Number(el.closest('[data-index]').dataset.index);data.items[index][el.dataset.item]=cleanText(el.value);if(["price","quantity"].includes(el.dataset.item))syncInventoryPrice(data.items[index]);}else return;update();queueSave();});
$('items').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b)return;const index=Number(b.dataset.remove),item=data.items[index];if((item.description.trim()||item.price.trim()||item.serial.trim())&&!confirm('¿Eliminar este producto de la boleta?'))return;data.items.splice(index,1);if(!data.items.length)data.items.push(newItem());renderItems();update();queueSave();});
$('addBtn').addEventListener('click',()=>{if(data.items.length>=MAX_ITEMS){toast('Puedes incluir hasta 100 productos por boleta.');return;}data.items.push(newItem());renderItems();update();queueSave();$(`description-${data.items.length-1}`).focus();});
$('newBtn').addEventListener('click',async()=>{if(!viewingIssued&&hasContent()&&!confirm('¿Iniciar una nueva boleta? Se limpiará el borrador.'))return;viewingIssued=false;cloudReceiptId=crypto.randomUUID();data=emptyReceipt('110',data.series.toUpperCase(),data.observations);resetErrors();hydrate();saveDraft();await refreshCloudNumber();$('customer').focus();toast('Nueva boleta lista.');});

$('exampleBtn').addEventListener('click',()=>{if(hasContent()&&!confirm('¿Reemplazar el borrador actual por una boleta de ejemplo?'))return;viewingIssued=false;cloudReceiptId=crypto.randomUUID();data=emptyReceipt(data.number,data.series);data.customer='CLIENTE DE EJEMPLO';data.docType='NONE';data.items=[{description:'SSD NVMe 1 TB',serial:'',code:'SSD-01',unit:'NIU',quantity:'1',price:'480.00'}];resetErrors();hydrate();saveDraft();toast('Ejemplo: SSD por S/ 480.00. Puedes editar todos los datos.');});
$('backupBtn').addEventListener('click',()=>{syncReceiptDate();download(JSON.stringify(data,null,2),filename('json'),'application/json');saveDraft();toast('Copia editable guardada. Recupérala con Abrir copia.');});
$('importBtn').addEventListener('click',()=>$('importFile').click());
$('importFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2*1024*1024)throw Error('La copia es demasiado grande.');const incoming=normalizeData(JSON.parse(await file.text()));if(hasContent()&&!confirm('¿Reemplazar el borrador actual por la copia seleccionada?'))return;viewingIssued=false;cloudReceiptId=crypto.randomUUID();data=incoming;data.date=today();resetErrors();hydrate();saveDraft();refreshCloudNumber();toast('Copia recuperada.');}catch(err){toast(err.message||'No se pudo abrir la copia.');}finally{e.target.value='';}});
$('exportBtn').addEventListener('click',exportPDF);$('exportMobileBtn').addEventListener('click',exportPDF);
$('prevPage').addEventListener('click',()=>{pageIndex--;renderPage();});$('nextPage').addEventListener('click',()=>{pageIndex++;renderPage();});
window.addEventListener('pagehide',saveDraft);
window.addEventListener('pageshow',syncReceiptDate);
window.addEventListener('focus',()=>{syncReceiptDate();initEmailService();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncReceiptDate();});
setInterval(syncReceiptDate,60000);
async function init(){hydrate();if(canStore)saveDraft();if(!canStore)$('saveStatus').textContent='Usa Guardar copia para conservar tu boleta';try{const scratch=await PDFLib.PDFDocument.create();fonts=await embedReceiptFonts(scratch);await loadPreviewFonts();ready=true;refreshPreview();document.querySelectorAll('.export-btn').forEach(b=>b.disabled=false);}catch(e){$('preview').innerHTML='<div class="initial-error">No se pudo iniciar el generador. Descarga el archivo HTML completo y ábrelo en Chrome o Edge.</div>';console.error(e);}}
init();
initEmailService();

function lockIssuedFields(){
 document.querySelectorAll('[data-field],[data-item],[data-remove],[data-inventory]').forEach(el=>el.disabled=viewingIssued);
 $('number').readOnly=true;$('date').readOnly=true;$('addBtn').disabled=viewingIssued;
 if(!viewingIssued)updateDocumentField();
 $('saveStatus').textContent=viewingIssued?'Boleta guardada en la nube · consulta disponible en el historial':'Borrador en este dispositivo · la venta se registra al emitir la boleta';
}
async function refreshCloudNumber(){if(viewingIssued)return false;const series=data.series.toUpperCase();if(!/^[A-Z0-9]{1,8}$/.test(series))return false;try{const n=await cloud.nextNumber(series);if(!viewingIssued&&data.series.toUpperCase()===series){data.number=String(n);$('number').value=data.number;update();saveDraft();return true;}}catch(e){toast('El número definitivo se asignará al exportar.');}return false;}
window.loadCloudReceipt=(receipt,id)=>{if(!viewingIssued&&hasContent()&&!confirm('¿Abrir esta boleta y reemplazar el borrador actual?'))return;data=normalizeData(receipt);cloudReceiptId=id;viewingIssued=true;autoAdvanceId=null;resetErrors();hydrate();saveDraft();toast('Boleta guardada. Puedes descargar el PDF o enviar su correo.');};
refreshCloudNumber();


function syncInventoryPrice(item){const price=centsFromInput(item.price),qty=quantityFromInput(item.quantity);if(item.inventory?.length&&price!==null&&qty!==null)item.inventory=window.parent.AOSuiteCore.repriceParts(item.inventory,price*qty);}
$('items').addEventListener('click',async e=>{
 const button=e.target.closest('[data-inventory]');if(!button||viewingIssued)return;
 const index=Number(button.dataset.inventory);button.disabled=true;
 try{const selected=await cloud.inventorySelection(structuredClone(data.items[index]),index);if(!selected)return;
   const item=data.items[index],previous=item.inventory||[];item.inventory=selected;const entered=centsFromInput(item.price);
   const same=selected.every(p=>p.name===selected[0].name&&p.price===selected[0].price);
   item.quantity=same?String(selected.length):'1';
   item.inventoryMode=same?'units':'bundle';
   if(entered===null)item.price=same?selected[0].price:((selected.reduce((n,p)=>n+centsFromInput(p.price),0))/100).toFixed(2);
   syncInventoryPrice(item);
   const autoDescription=parts=>parts.length?(parts.every(p=>p.name===parts[0].name)?parts[0].name:'Computadora completa: '+parts.map(p=>p.name).join(', ')).slice(0,350):'';
   if(!item.description.trim()||item.description===autoDescription(previous))item.description=autoDescription(selected);
   renderItems();update();queueSave();
 }catch(error){toast(error.message);}finally{button.disabled=false;}
});
window.getInventoryIdsExcept=index=>data.items.flatMap((item,i)=>i===index?[]:(item.inventory||[]).filter(p=>p.source==='stock').map(p=>String(p.id)));
window.resetDeletedReceipt=id=>{
 if(cloudReceiptId!==id)return;
 pendingDelivery=null;viewingIssued=false;cloudReceiptId=crypto.randomUUID();
 data=emptyReceipt('110',data.series.toUpperCase(),data.observations);
 resetErrors();hydrate();saveDraft();$('emailDeliveryStatus').hidden=true;
 refreshCloudNumber();toast('La boleta fue eliminada. Puedes crear una nueva con los datos correctos.');
};

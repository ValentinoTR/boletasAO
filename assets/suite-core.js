"use strict";
(() => {
  const cents = value => {
    const s=String(value??'').trim().replace(',','.');
    if(!/^\d{1,9}(\.\d{1,2})?$/.test(s))throw Error('Ingresa un importe válido con hasta dos decimales.');
    const [a,b='']=s.split('.');return Number(a)*100+Number(b.padEnd(2,'0'));
  };
  const optionalCents=value=>String(value??'').trim()===''?0:cents(value);
  const realCost=p=>(p.moneda==='USD'?Number(p.costo)*Number(p.tipo_cambio):Number(p.costo))*(1+Number(p.impuesto||0)/100)+Number(p.peso_kg||0)*Number(p.costo_envio_kg||0)+Number(p.tax_usa||0)+Number(p.impuesto_peru||0)+Number(p.otros_gastos||0);
  const allocate=(purchase,units)=>{
    const manual=units.filter(u=>u.costo!==null&&u.costo!==undefined);
    const missing=units.length-manual.length;
    const remaining=Math.max(0,realCost(purchase)-manual.reduce((n,u)=>n+Number(u.costo),0));
    return units.map(u=>({...u,calculatedCost:Math.round(((u.costo!==null&&u.costo!==undefined?Number(u.costo):(missing?remaining/missing:0))+Number.EPSILON)*100)/100,estimated:u.costo===null||u.costo===undefined}));
  };
  const validateParts=parts=>{
    if(!Array.isArray(parts)||!parts.length)throw Error('Elige al menos un producto de «Mi stock» o agrega uno que no esté en tu stock.');
    const ids=new Set();let total=0;
    for(const p of parts){total+=cents(p.price);if(p.source==='stock'){const id=String(p.id);if(!/^\d+$/.test(id)||ids.has(id))throw Error('Una unidad de stock está repetida o es inválida.');ids.add(id);}else if(p.source==='external'){optionalCents(p.cost);if(!String(p.name||'').trim())throw Error('Indica el nombre del producto comprado.');}else throw Error('Origen de producto inválido.');}
    return total;
  };
  const repriceParts=(parts,totalCents)=>{
    if(!Array.isArray(parts)||!parts.length)return [];
    if(!Number.isSafeInteger(totalCents)||totalCents<0)throw Error('Importe de venta inválido.');
    let weights=parts.map(p=>BigInt(cents(p.price))),sum=weights.reduce((n,w)=>n+w,0n);
    if(sum===0n){weights=parts.map(()=>1n);sum=BigInt(parts.length);}
    const total=BigInt(totalCents),result=weights.map((w,i)=>({i,value:total*w/sum,remainder:total*w%sum}));
    const remainder=Number(total-result.reduce((n,r)=>n+r.value,0n));
    const sorted=[...result].sort((a,b)=>a.remainder>b.remainder?-1:a.remainder<b.remainder?1:a.i-b.i);
    for(let i=0;i<remainder;i++)sorted[i].value++;
    return parts.map((p,i)=>({...p,price:(Number(result[i].value)/100).toFixed(2)}));
  };
  const available=unit=>unit.precio_venta===null&&unit.in_stock!==false;
  const quantity=value=>{const text=String(value).trim();if(!/^\d{1,6}$/.test(text)||Number(text)>100000)throw Error('Ingresa una cantidad entera válida.');return Number(text);};
  const productStock=(product,units)=>product.managed?units.filter(u=>available(u)&&String(u.product_id)===String(product.id)).length:Number(product.reference_stock||0);
  const filterStock=(products,units,mode)=>products.filter(p=>mode==='replenish'?productStock(p,units)===0:productStock(p,units)>0);
  // Productos del catálogo anterior: su cantidad es un número sin unidades reales, así que las ventas no pueden descontarla.
  const legacyProducts=products=>products.filter(p=>!p.managed&&Number(p.reference_stock||0)>0);
  // La función de stock registra hasta 1000 unidades por compra.
  const activatableProducts=products=>legacyProducts(products).filter(p=>Number(p.reference_stock)<=1000);
  // Registra esa cantidad como unidades reales sin costo; desde entonces cada venta descuenta una unidad.
  const legacyStockArgs=(product,requestKey,date)=>({request_key:requestKey,product_key:product.id,product_name:product.data.name,target_quantity:Number(product.reference_stock||0),expected_quantity:0,cost_per_unit:0,supplier:'Stock inicial (catálogo anterior)',purchased_on:date});
  const api={cents,optionalCents,legacyProducts,activatableProducts,legacyStockArgs,realCost,allocate,validateParts,repriceParts,available,quantity,productStock,filterStock};
  if(typeof window!=='undefined')window.AOSuiteCore=api;
  if(typeof module!=='undefined')module.exports=api;
})();

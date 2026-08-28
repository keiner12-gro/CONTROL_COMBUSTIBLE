const express=require('express');
const {requirePermission}=require('../../shared/infrastructure/security');
const {convertirRegistroParaFrontend}=require('../../records/domain/record.mapper');
function rango(a,m){const d=new Date(a,m,0).getDate();return{inicio:`${a}-${String(m).padStart(2,'0')}-01`,fin:`${a}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`}}
function crearRutasReportes(s){const r=express.Router();
 r.get('/reportes',requirePermission('reportes'),async(q,x,n)=>{try{x.json(await s.list())}catch(e){n(e)}});
 r.get('/reportes-general/registros',requirePermission('reportes'),async(q,x,n)=>{try{const a=new Date().getFullYear(),rows=await s.listGeneral(q.query.fechaInicio||`${a}-01-01`,q.query.fechaFin||`${a}-12-31`,String(q.query.busqueda||'').trim());x.json(rows.map(convertirRegistroParaFrontend))}catch(e){n(e)}});
 r.get('/reportes/:anio/:mes/registros',requirePermission('reportes'),async(q,x,n)=>{try{const z=rango(Number(q.params.anio),Number(q.params.mes)),rows=await s.listGeneral(z.inicio,z.fin,'');x.json(rows.map(convertirRegistroParaFrontend))}catch(e){n(e)}});
 return r;}
module.exports={crearRutasReportes};

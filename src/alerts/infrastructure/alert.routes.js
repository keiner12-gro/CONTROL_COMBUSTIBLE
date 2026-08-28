const express=require('express');
const {requirePermission}=require('../../shared/infrastructure/security');
const {registrarAuditoria}=require('../../shared/infrastructure/audit');
function crearRutasAlertas(service,db){const router=express.Router();
 router.get('/alertas',requirePermission('alertas'),async(req,res,next)=>{try{res.json(await service.list());}catch(e){next(e);}});
 router.get('/alertas/reportes/:anio/:mes',requirePermission('alertas'),async(req,res,next)=>{try{const a=Number(req.params.anio),m=Number(req.params.mes);const last=new Date(a,m,0).getDate();res.json(await service.listByDateRange(`${a}-${String(m).padStart(2,'0')}-01`,`${a}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`));}catch(e){next(e);}});
 router.get('/notificaciones',requirePermission('alertas'),async(req,res,next)=>{try{res.json(await service.listNotifications(req.user.rol));}catch(e){next(e);}});
 router.put('/notificaciones/:id/leida',requirePermission('alertas'),async(req,res,next)=>{try{await service.markNotification(req.params.id,req.user.rol);res.json({mensaje:'Notificación marcada como leída.'});}catch(e){next(e);}});
 router.put('/alertas/:id',requirePermission('alertas'),async(req,res,next)=>{try{const z=await service.update(req.params.id,{...req.body,rol:req.user.rol,usuario:req.user.usuario});await registrarAuditoria(db,{usuarioId:req.user.id,usuario:req.user.usuario,rol:req.user.rol,accion:'JUSTIFICAR',modulo:'alertas',registroId:req.params.id,detalle:{justificacion:req.body.justificacion}});res.json(z);}catch(e){next(e);}});
 return router;}
module.exports={crearRutasAlertas};

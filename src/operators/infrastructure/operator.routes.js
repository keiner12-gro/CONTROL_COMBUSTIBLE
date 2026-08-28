const express=require('express');
const {requireSuperAdmin}=require('../../shared/infrastructure/security');
const {registrarAuditoria}=require('../../shared/infrastructure/audit');
function crearRutasOperarios(s,db){const r=express.Router();
 r.get('/operarios',async(q,x,n)=>{const permiso=q.query.selector==='1'?'registro':'operarios';try{if(q.user.rol!=='super_administrador'&&!q.user.permisos.includes(permiso))return x.status(403).json({mensaje:'No tienes permiso para consultar operarios.'});x.json(await s.list())}catch(e){n(e)}});
 r.post('/operarios',requireSuperAdmin,async(q,x,n)=>{try{const z=await s.create(q.body);await registrarAuditoria(db,{usuarioId:q.user.id,usuario:q.user.usuario,rol:q.user.rol,accion:'CREAR',modulo:'operarios',registroId:z.id,detalle:z});x.status(201).json(z)}catch(e){n(e)}});
 r.delete('/operarios/:id',requireSuperAdmin,async(q,x,n)=>{try{await s.remove(q.params.id);await registrarAuditoria(db,{usuarioId:q.user.id,usuario:q.user.usuario,rol:q.user.rol,accion:'ELIMINAR',modulo:'operarios',registroId:q.params.id});x.json({mensaje:'Operario eliminado. Los registros históricos no se modificaron.'})}catch(e){n(e)}});
 return r;}
module.exports={crearRutasOperarios};

const express=require('express');
const {requirePermission}=require('../../shared/infrastructure/security');
const {registrarAuditoria}=require('../../shared/infrastructure/audit');
function crearRutasTractores(s,db){const r=express.Router();
 r.get('/tractores',async(q,x,n)=>{const permiso=q.query.selector==='1'?'registro':'tractores';try{if(q.user.rol!=='super_administrador'&&!q.user.permisos.includes(permiso))return x.status(403).json({mensaje:'No tienes permiso para consultar máquinas.'});x.json(await s.list())}catch(e){n(e)}});
 r.post('/tractores',requirePermission('tractores'),async(q,x,n)=>{try{const z=await s.create(q.body);await registrarAuditoria(db,{usuarioId:q.user.id,usuario:q.user.usuario,rol:q.user.rol,accion:'CREAR',modulo:'tractores',registroId:z.id,detalle:z});x.status(201).json(z)}catch(e){n(e)}});
 r.put('/tractores/:id',requirePermission('tractores'),async(q,x,n)=>{try{const tractor=await s.update(q.params.id,q.body);if(!tractor)return x.status(404).json({mensaje:'Máquina no encontrada.'});await registrarAuditoria(db,{usuarioId:q.user.id,usuario:q.user.usuario,rol:q.user.rol,accion:'EDITAR',modulo:'tractores',registroId:q.params.id,detalle:q.body});x.json(tractor)}catch(e){n(e)}});
 r.delete('/tractores/:id',requirePermission('tractores'),async(q,x,n)=>{try{await s.remove(q.params.id);await registrarAuditoria(db,{usuarioId:q.user.id,usuario:q.user.usuario,rol:q.user.rol,accion:'ELIMINAR',modulo:'tractores',registroId:q.params.id});x.json({mensaje:'Máquina eliminada. Los registros históricos no se modificaron.'})}catch(e){n(e)}});
 return r;}
module.exports={crearRutasTractores};

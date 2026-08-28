const fs=require('fs/promises');
const path=require('path');
const crypto=require('crypto');
class AlertService{
  constructor(repository){this.repository=repository;}
  async list(){return this.repository.list();}
  async create(alerta){
    const tipo=alerta.tipoAlerta||'sobrecapacidad';
    const existente=alerta.registroId?await this.repository.findByRegistro(alerta.registroId,tipo):null;
    if(existente)return existente;
    return this.repository.create(alerta);
  }
  async update(id,datos){
    const alerta=(await this.repository.list()).find(a=>String(a.id)===String(id));
    if(!alerta)throw Object.assign(new Error('La alerta no existe.'),{status:404});

    const justificacion=String(datos.justificacion||'').trim();
    if(!justificacion)throw Object.assign(new Error('La justificación es obligatoria.'),{status:400});

    // El archivo es opcional. Si se adjunta, se valida y se almacena; si no,
    // la alerta queda justificada solamente con el texto ingresado.
    const actualizado={
      justificacion,
      estado:'justificada',
      justificadoPor:String(datos.usuario||datos.rol||'usuario').trim()||'usuario',
      justificadoEn:new Date()
    };

    if(datos.reporteBase64){
      const [meta,data]=String(datos.reporteBase64).split(',',2);
      const mime=(meta.match(/data:([^;]+);base64/i)||[])[1]||datos.reporteTipo||'application/octet-stream';
      const permitidos=['application/pdf','image/png','image/jpeg','image/webp'];
      if(!permitidos.includes(mime))throw Object.assign(new Error('El reporte debe ser PDF, PNG, JPG o WEBP.'),{status:400});
      const buffer=Buffer.from(data||'','base64');
      if(!buffer.length||buffer.length>8*1024*1024)throw Object.assign(new Error('El reporte debe pesar máximo 8 MB.'),{status:400});
      const ext={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]||'bin';
      const nombreOriginal=String(datos.reporteNombre||`reporte-alerta-${id}.${ext}`).replace(/[^a-zA-Z0-9._-]/g,'_');
      const nombre=`${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${nombreOriginal}`;
      const carpeta=path.join(__dirname,'../../../uploads/reportes_alertas');
      await fs.mkdir(carpeta,{recursive:true});
      await fs.writeFile(path.join(carpeta,nombre),buffer);
      actualizado.reporteNombre=nombreOriginal;
      actualizado.reporteRuta=`/uploads/reportes_alertas/${nombre}`;
      actualizado.reporteTipo=mime;
    }

    await this.repository.update(id,actualizado);

    // La notificación solo se considera leída cuando la alerta quedó justificada.
    // Al justificarse, se cierran las notificaciones de todos los roles asociados
    // a esa misma alerta para que no sigan apareciendo como pendientes.
    if (typeof this.repository.markNotificationsForAlert === 'function') {
      await this.repository.markNotificationsForAlert(id);
    }

    return {...alerta,...actualizado};
  }

  listNotifications(rol){return this.repository.listNotifications(rol);}
  markNotification(id,rol){return this.repository.markNotification(id,rol);}
  listByDateRange(i,f){return this.repository.listByDateRange(i,f);}
}
module.exports={AlertService};

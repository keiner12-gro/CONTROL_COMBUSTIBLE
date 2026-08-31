const {convertirRegistroParaFrontend}=require('../domain/record.mapper');const bad=(m)=>Object.assign(new Error(m),{status:400});
const HOROMETRO_NUMERICO=/^[0-9]+([.,][0-9]+)?$/;
class RecordService{
  constructor(repository,tractorRepository,alertService){this.repository=repository;this.tractorRepository=tractorRepository;this.alertService=alertService;}
  async list(){return(await this.repository.list()).map(convertirRegistroParaFrontend);}
  async create(x){
    x={...x,operario:String(x.operario||'').trim().toUpperCase(),maquina:String(x.maquina||'').trim().toUpperCase(),cedula:String(x.cedula||'').trim(),numeroSai:String(x.numeroSai||'').trim().toUpperCase()};
    if(!x.m1Inicial&&!x.m2Inicial)throw bad('Debes tener al menos una lectura inicial disponible para iniciar el registro.');
    if(!x.firma)throw bad('La firma del operario es obligatoria.');
    const cierre=x.cierreDia===true||x.cierreDia===1||x.cierreDia==='1'||x.cierreDia==='true';
    if(cierre&&await this.repository.findDailyClosing(x.fecha))throw bad('Ya existe un cierre del dia para esta fecha.');
    const h=Number(String(x.horometro||'').replace(',','.'));if(Number.isFinite(h)){const ultimo=await this.repository.latestHourmeter(x.maquina);if(ultimo&&h<ultimo)throw bad(`El horometro no puede ser menor al ultimo registrado para ${x.maquina}: ${ultimo}.`);}
    const check=!(await this.repository.hasChecklist(x.fecha));
    const id=await this.repository.insert({...x,cierreDia:cierre,fugaBiodiesel:check?x.fugaBiodiesel:null,sistemaElectrico:check?x.sistemaElectrico:null,paradaEmergencia:check?x.paradaEmergencia:null});
    const cantidad=Number(x.cantidad||0);
    const tractor=(!cierre&&x.maquina&&this.tractorRepository)?await this.tractorRepository.findByMachine(x.maquina):null;
    const capacidad=Number(tractor?.capacidad_galones||0);
    if(this.alertService&&!cierre){
      if(capacidad>0&&cantidad>capacidad){
        await this.alertService.create({registroId:id,fecha:x.fecha,maquina:x.maquina,operario:x.operario,cantidad,capacidadGalones:capacidad,excesoGalones:cantidad-capacidad,observaciones:x.observaciones,tipoAlerta:'sobrecapacidad'});
      } else if(this.repository.averageQuantityByMachine){
        const estadistica=await this.repository.averageQuantityByMachine(x.maquina,id);
        const minimoMuestras=Number(process.env.MIN_MUESTRAS_PROMEDIO||5);
        const factor=Number(process.env.FACTOR_ALERTA_PROMEDIO||1.25);
        if(estadistica.muestras>=minimoMuestras&&estadistica.promedio>0&&cantidad>estadistica.promedio*factor){
          const porcentaje=(cantidad/estadistica.promedio-1)*100;
          await this.alertService.create({registroId:id,fecha:x.fecha,maquina:x.maquina,operario:x.operario,cantidad,capacidadGalones:0,excesoGalones:cantidad-estadistica.promedio,observaciones:x.observaciones,tipoAlerta:'promedio',promedioGalones:estadistica.promedio,porcentajeSobrePromedio:porcentaje});
        }
      }

      const horometroTexto=String(x.horometro||'').trim();
      if(horometroTexto&&!HOROMETRO_NUMERICO.test(horometroTexto)){
        const anterior=this.repository.latestHourmeter?await this.repository.latestHourmeter(x.maquina):0;
        await this.alertService.create({registroId:id,fecha:x.fecha,maquina:x.maquina,operario:x.operario,cantidad,capacidadGalones:0,excesoGalones:0,observaciones:x.observaciones,tipoAlerta:'horometro_irregular',detalle:horometroTexto,valorReferencia:anterior||null});
      }
    }
    return{...x,id:String(id),capacidadGalones:capacidad,alertaSobrecapacidad:capacidad>0&&cantidad>capacidad};
  }
  async getDailyMeterState(fecha){ return this.repository.getDailyMeterState(fecha); }
  machineConsumptionStats(inicio,fin){ return this.repository.machineConsumptionStats(inicio,fin); }
  async saveDailyClosing(x){
    if(!x.m1Final&&!x.m2Final)throw bad('Debes ingresar al menos una lectura final: M1, M2 o ambas.');
    const estado=await this.repository.getDailyMeterState(x.fecha);
    if(estado.hayCierreDiaAnterior){
      if(estado.m1Anterior!==null&&String(x.m1Inicial||'')!==''&&Number(x.m1Inicial)!==Number(estado.m1Anterior))throw bad(`La lectura inicial de M1 debe coincidir con el cierre anterior: ${estado.m1Anterior}.`);
      if(estado.m2Anterior!==null&&String(x.m2Inicial||'')!==''&&Number(x.m2Inicial)!==Number(estado.m2Anterior))throw bad(`La lectura inicial de M2 debe coincidir con el cierre anterior: ${estado.m2Anterior}.`);
      x.m1Inicial=estado.m1Anterior??x.m1Inicial;x.m2Inicial=estado.m2Anterior??x.m2Inicial;
    }
    if(x.m1Final&&(!x.m1Inicial||Number(x.m1Final)<Number(x.m1Inicial)))throw bad('La lectura final de M1 no puede ser menor que su inicial.');
    if(x.m2Final&&(!x.m2Inicial||Number(x.m2Final)<Number(x.m2Inicial)))throw bad('La lectura final de M2 no puede ser menor que su inicial.');
    const cierre=await this.repository.findDailyClosing(x.fecha);
    let id;
    if(cierre){
      const check=!(await this.repository.hasChecklist(x.fecha,cierre.id));
      await this.repository.updateDailyClosing(cierre.id,x,check);
      id=cierre.id;
    }else{
      const check=!(await this.repository.hasChecklist(x.fecha));
      id=await this.repository.insert({...x,cierreDia:true,operario:null,cedula:null,maquina:null,horometro:null,cantidad:null,numeroSai:null,firma:null,observaciones:null,fugaBiodiesel:check?x.fugaBiodiesel:null,sistemaElectrico:check?x.sistemaElectrico:null,paradaEmergencia:check?x.paradaEmergencia:null});
    }
    if(this.alertService&&!(await this.repository.hasChecklist(x.fecha))){
      await this.alertService.create({registroId:id,fecha:x.fecha,maquina:'Cierre de día',operario:null,cantidad:0,capacidadGalones:0,excesoGalones:0,observaciones:'Checklist diario sin diligenciar.',tipoAlerta:'inspeccion_pendiente'});
    }
    return convertirRegistroParaFrontend(await this.repository.findById(id));
  }
  listByDateRange(i,f,b){return this.repository.findByDateRange(i,f,b).then(r=>r.map(convertirRegistroParaFrontend));}
  update(id,c){return this.repository.update(id,c)} remove(id){return this.repository.remove(id)}
}
module.exports={RecordService};

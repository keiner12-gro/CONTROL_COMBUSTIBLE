const {RecordRepository}=require('../domain/record.repository');
class MySQLRecordRepository extends RecordRepository{
 constructor(db){super();this.db=db;}
 async list(){const[r]=await this.db.query('SELECT * FROM registros_combustible ORDER BY id DESC');return r;}
 async findById(id){const[r]=await this.db.query('SELECT * FROM registros_combustible WHERE id=?',[id]);return r[0]||null;}
 async insert(x){const[r]=await this.db.query(`INSERT INTO registros_combustible(fecha,m1_inicial,m1_final,m2_inicial,m2_final,galones_m1,galones_m2,total_galones,fuga_biodiesel,sistema_electrico,parada_emergencia,cierre_dia,operario,cedula,maquina,horometro,cantidad,numero_sai,firma,observaciones) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[x.fecha||null,x.m1Inicial||null,x.m1Final||null,x.m2Inicial||null,x.m2Final||null,x.galonesM1||null,x.galonesM2||null,x.totalGalones||null,x.fugaBiodiesel||null,x.sistemaElectrico||null,x.paradaEmergencia||null,x.cierreDia?1:0,x.operario||null,x.cedula||null,x.maquina||null,x.horometro||null,x.cantidad||null,x.numeroSai||null,x.firma||null,x.observaciones||null]);return r.insertId;}

 async getDailyMeterState(fecha){
   const [rows]=await this.db.query(`SELECT id,fecha,m1_inicial,m1_final,m2_inicial,m2_final,cierre_dia,operario,maquina FROM registros_combustible WHERE fecha=? ORDER BY id DESC`,[fecha]);
   const [prev]=await this.db.query(`SELECT id,fecha,m1_final,m2_final,cierre_dia FROM registros_combustible WHERE fecha=DATE_SUB(?,INTERVAL 1 DAY) ORDER BY id DESC`,[fecha]);
   const cierreActual=rows.find(x=>Number(x.cierre_dia)===1)||null;
   const cierreAnterior=prev.find(x=>Number(x.cierre_dia)===1)||null;
   return {fecha,hayRegistrosDia:rows.length>0,hayCierreDia:Boolean(cierreActual),cierreActual,fechaAnterior:prev[0]?.fecha||null,hayRegistrosDiaAnterior:prev.length>0,hayCierreDiaAnterior:Boolean(cierreAnterior),m1Anterior:cierreAnterior?.m1_final??null,m2Anterior:cierreAnterior?.m2_final??null};
 }

 async findDailyClosing(fecha){const[r]=await this.db.query('SELECT id FROM registros_combustible WHERE fecha=? AND cierre_dia=1 LIMIT 1',[fecha||null]);return r[0]||null;}
 async updateDailyClosing(id,x,check){await this.db.query(`UPDATE registros_combustible SET m1_inicial=COALESCE(?,m1_inicial),m1_final=COALESCE(?,m1_final),m2_inicial=COALESCE(?,m2_inicial),m2_final=COALESCE(?,m2_final),galones_m1=COALESCE(?,galones_m1),galones_m2=COALESCE(?,galones_m2),total_galones=COALESCE(?,total_galones),fuga_biodiesel=COALESCE(?,fuga_biodiesel),sistema_electrico=COALESCE(?,sistema_electrico),parada_emergencia=COALESCE(?,parada_emergencia) WHERE id=?`,[x.m1Inicial||null,x.m1Final||null,x.m2Inicial||null,x.m2Final||null,x.galonesM1||null,x.galonesM2||null,x.totalGalones||null,check?x.fugaBiodiesel||null:null,check?x.sistemaElectrico||null:null,check?x.paradaEmergencia||null:null,id]);}
 async hasChecklist(fecha,ignored=null){const f=['fecha=?','(fuga_biodiesel IS NOT NULL OR sistema_electrico IS NOT NULL OR parada_emergencia IS NOT NULL)'],v=[fecha||null];if(ignored){f.push('id<>?');v.push(ignored)}const[r]=await this.db.query(`SELECT id FROM registros_combustible WHERE ${f.join(' AND ')} LIMIT 1`,v);return r.length>0;}
 async machineConsumptionStats(inicio,fin){
   const [r]=await this.db.query(`SELECT r.maquina,COUNT(*) AS registros,COALESCE(SUM(r.cantidad),0) AS total_galones,COALESCE(AVG(r.cantidad),0) AS promedio_galones,COALESCE(MAX(r.cantidad),0) AS maximo_galones,COALESCE(t.capacidad_galones,0) AS capacidad_galones,t.descripcion AS descripcion FROM registros_combustible r LEFT JOIN tractores t ON UPPER(t.maquina)=UPPER(r.maquina) WHERE r.cierre_dia=0 AND r.fecha BETWEEN ? AND ? AND r.cantidad IS NOT NULL AND r.cantidad>0 GROUP BY r.maquina,t.capacidad_galones,t.descripcion ORDER BY total_galones DESC`,[inicio,fin]);
   return r.map(x=>({...x,registros:Number(x.registros),totalGalones:Number(x.total_galones),promedioGalones:Number(x.promedio_galones),maximoGalones:Number(x.maximo_galones),capacidadGalones:Number(x.capacidad_galones),descripcion:x.descripcion||null}));
 }

 async averageQuantityByMachine(maquina,excludeId=null){
   const f=['cierre_dia=0','cantidad IS NOT NULL','cantidad>0','UPPER(maquina)=UPPER(?)'],v=[maquina||''];if(excludeId){f.push('id<>?');v.push(excludeId);}
   const [r]=await this.db.query(`SELECT COUNT(*) AS muestras,COALESCE(AVG(cantidad),0) AS promedio FROM registros_combustible WHERE ${f.join(' AND ')}`,v);
   return {muestras:Number(r[0]?.muestras||0),promedio:Number(r[0]?.promedio||0)};
 }

 async latestHourmeter(maquina){const[r]=await this.db.query(`SELECT MAX(CAST(REPLACE(horometro,',','.') AS DECIMAL(12,2))) AS ultimo_horometro FROM registros_combustible WHERE maquina=? AND horometro REGEXP '^[0-9]+([,.][0-9]+)?$'`,[maquina||'']);return Number(r[0].ultimo_horometro)||0;}
 async findByDateRange(inicio,fin,busqueda=''){const f=['fecha BETWEEN ? AND ?'],v=[inicio,fin];if(busqueda){f.push('(maquina LIKE ? OR operario LIKE ?)');v.push(`%${busqueda}%`,`%${busqueda}%`)}const[r]=await this.db.query(`SELECT * FROM registros_combustible WHERE ${f.join(' AND ')} ORDER BY fecha ASC,id ASC`,v);return r;}
 async update(id,c){const map={operario:'operario',cedula:'cedula',maquina:'maquina',horometro:'horometro',cantidad:'cantidad',numeroSai:'numero_sai',observaciones:'observaciones'},e=Object.entries(c).filter(([k])=>map[k]);if(!e.length)return false;await this.db.query(`UPDATE registros_combustible SET ${e.map(([k])=>`${map[k]}=?`).join(',')} WHERE id=?`,[...e.map(([k,v])=>['operario','maquina','numeroSai'].includes(k)?String(v||'').trim().toUpperCase():v),id]);return true;}
 async remove(id){await this.db.query('DELETE FROM registros_combustible WHERE id=?',[id]);}
 async summarizeByMonth(){const[r]=await this.db.query(`SELECT YEAR(fecha) AS anio,MONTH(fecha) AS mes,COALESCE(SUM(CASE WHEN(cierre_dia=1 OR(cierre_dia=0 AND m1_inicial IS NOT NULL AND m1_final IS NOT NULL AND m2_inicial IS NOT NULL AND m2_final IS NOT NULL AND(operario IS NULL OR TRIM(operario)='') AND(maquina IS NULL OR TRIM(maquina)=''))) THEN 0 ELSE 1 END),0) AS totalRegistros,COALESCE(SUM(CASE WHEN(cierre_dia=1 OR(cierre_dia=0 AND m1_inicial IS NOT NULL AND m1_final IS NOT NULL AND m2_inicial IS NOT NULL AND m2_final IS NOT NULL AND(operario IS NULL OR TRIM(operario)='') AND(maquina IS NULL OR TRIM(maquina)=''))) THEN COALESCE(total_galones,0) ELSE 0 END),0) AS totalGalones FROM registros_combustible WHERE fecha IS NOT NULL GROUP BY YEAR(fecha),MONTH(fecha)`);return r;}
}
module.exports={MySQLRecordRepository};

const {TractorRepository}=require('../domain/tractor.repository');
class MySQLTractorRepository extends TractorRepository{
  constructor(db){super();this.db=db;}
  async list(){const[r]=await this.db.query('SELECT id,item,maquina,descripcion,centro_costo,capacidad_galones FROM tractores ORDER BY item ASC,maquina ASC');return r;}
  async findByMachine(maquina){const[r]=await this.db.query('SELECT id,item,maquina,descripcion,centro_costo,capacidad_galones FROM tractores WHERE UPPER(maquina)=UPPER(?) LIMIT 1',[maquina||'']);return r[0]||null;}
  async create(d){const[[x]]=await this.db.query('SELECT COALESCE(MAX(item),0)+1 AS siguiente_item FROM tractores');const item=Number(x.siguiente_item),maquina=String(d.maquina||'').trim().toUpperCase(),descripcion=String(d.descripcion||'').trim().toUpperCase(),centro_costo=String(d.centro_costo||'').trim().toUpperCase(),capacidad_galones=Number(d.capacidad_galones||0);const[r]=await this.db.query('INSERT INTO tractores(item,maquina,descripcion,centro_costo,capacidad_galones) VALUES(?,?,?,?,?)',[item,maquina,descripcion,centro_costo,capacidad_galones]);return{id:r.insertId,item,maquina,descripcion,centro_costo,capacidad_galones};}
  async update(id,d){const maquina=String(d.maquina||'').trim().toUpperCase(),descripcion=String(d.descripcion||'').trim().toUpperCase(),centro_costo=String(d.centro_costo||'').trim().toUpperCase(),capacidad_galones=Number(d.capacidad_galones||0);const[r]=await this.db.query('UPDATE tractores SET maquina=?,descripcion=?,centro_costo=?,capacidad_galones=? WHERE id=?',[maquina,descripcion,centro_costo,capacidad_galones,id]);if(!r.affectedRows)return null;const[x]=await this.db.query('SELECT id,item,maquina,descripcion,centro_costo,capacidad_galones FROM tractores WHERE id=?',[id]);return x[0]||null;}
  async remove(id){await this.db.query('DELETE FROM tractores WHERE id=?',[id]);}
}
module.exports={MySQLTractorRepository};

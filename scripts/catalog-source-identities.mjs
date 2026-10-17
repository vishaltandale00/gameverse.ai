// Catalog identities are discovery candidates, never host/donor role assignments.
const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const canonical=id=>id.replace(/^(pokemon-(?:leafgreen|firered|emerald|ruby|sapphire))-version$/,'$1');
const contains=(text,phrase)=>phrase&&(' '+text+' ').includes(' '+phrase+' ');
export function discoverSourceIdentities(intent,games=[]){
 const text=normalize(intent),rows=[];
 for(const game of games){
  const id=canonical(game.id),name=game.name||game.label||game.id;
  const prefix=name.split(':')[0],short=prefix.split(/\s+/).map(w=>/^[0-9]+$/.test(w)?w:w[0]||'').join('');
  const aliases=[id,game.id,name,...(game.aliases||[]),...(prefix!==name&&prefix.split(/\s+/).length>1?[prefix]:[]),...(short.length>=3?[short]:[])].map(normalize);
  const family=normalize(name).replace(/^(?:(?:the|super|legend|of|a)\s+)+/,'').split(' ')[0];
  rows.push({id,name,aliases:[...new Set(aliases)],family});
 }
 const aliasOwners=new Map();for(const row of rows)for(const alias of row.aliases){const ids=aliasOwners.get(alias)||new Set();ids.add(row.id);aliasOwners.set(alias,ids);}
 const matches=rows.flatMap(row=>row.aliases.filter(alias=>aliasOwners.get(alias).size===1).flatMap(alias=>{const needle=' '+alias+' ',haystack=' '+text+' ',found=[];let offset=0,index;while((index=haystack.indexOf(needle,offset))!==-1){found.push({row,start:index,end:index+needle.length});offset=index+1;}return found;}));
 // A longer title covers its embedded prefix, but a separate explicit mention remains selected.
 const specific=rows.filter(row=>matches.some(match=>match.row===row&&!matches.some(other=>other.row!==row&&other.start<=match.start&&other.end>=match.end&&(other.start<match.start||other.end>match.end))));
 const families=new Map();for(const row of rows){const list=families.get(row.family)||[];list.push(row);families.set(row.family,list);}
 const ambiguous=[];
 for(const [family,members]of families){
  if(members.length<2)continue;
  let words=normalize(members[0].name).replace(/^(?:(?:the|super|legend|of|a)\s+)+/,'').split(' ');
  for(const row of members.slice(1)){const next=normalize(row.name).replace(/^(?:(?:the|super|legend|of|a)\s+)+/,'').split(' ');words=words.slice(0,words.findIndex((word,i)=>word!==next[i])<0?words.length:words.findIndex((word,i)=>word!==next[i]));}
  if(contains(text,words.join(' '))&&!specific.some(row=>row.family===family))ambiguous.push(...members);
 }
 const candidates=[...new Map([...specific,...ambiguous].map(row=>[row.id,{id:row.id,name:row.name,aliases:row.aliases}])).values()];
 return {resolved:specific.map(row=>row.id),source_candidates:candidates,ambiguous:ambiguous.length>0};
}

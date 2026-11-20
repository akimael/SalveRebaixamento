const $ = (s) => document.querySelector(s);
const screens = ["home-screen","club-screen","campaign-screen","match-screen"];
let clubs = [];
let selectedClub = null;
let squad = [];
let secondsLeft = 300;
let timerId = null;
let day = 1;
let messages = [{title:"A diretoria te deseja boa sorte!",text:"Você tem uma missão difícil pela frente. Faça o necessário para manter o clube na Série A."}];
let selectedPlayer = null;
let pendingSwapId = null;
let morale = 60;
let tutorialStep = 0;
let tutorialSeen = false;
const tutorialTips = [
  ["Bem-vindo ao desafio!","Seu clube começa na 18ª posição, dentro da zona de rebaixamento. Você tem seis partidas para tentar escapar da queda."],
  ["Controle o tempo","Use AVANÇAR MINUTO para avançar 60 segundos ou PRÓXIMO DIA para passar ao dia seguinte."],
  ["Mercado de transferências","Envie propostas. As respostas chegam após um minuto de tempo real e aparecem na caixa de mensagens."],
  ["Caixa de mensagens","Acompanhe pedidos da diretoria, jogadores e dirigentes, além de novidades das negociações."],
  ["Meu clube","Veja o orçamento, a formação e os números da temporada desde a sua chegada."],
  ["Escalação e cartões","Clique em um jogador e depois em SUBSTITUIR. Escolha outro jogador do campo ou banco para trocar. Observe os cartões amarelos e as suspensões."],
  ["Treinamento e moral","Nos dias livres, será possível selecionar cinco atletas para treinar. A moral do elenco começa em 60% e mudará com os resultados."],
  ["Dia de jogo","Antes da partida, você poderá analisar o adversário, ajustar a escalação e definir orientações. Durante a partida, será possível pausar e alterar a equipe."]
];
let formation = "4-3-3";
const formations = ["4-3-3","4-4-2","4-2-3-1","3-5-2","5-3-2","4-1-4-1"];
let calendar = [];
let trainedDays = new Set();
let trainingSelection = new Set();
let lastTrainingDay = {};
let requestDay = 0;
let marketClock=0; // segundos do relógio interno da campanha
let transferOffers = [];
// Parte 15: valores fictícios de balanceamento, metade do planejamento aprovado.
const CLUB_BUDGETS={
 'Flamengo':83000000,'Palmeiras':73000000,'Cruzeiro':48000000,'Corinthians':38000000,
 'Botafogo':35500000,'Bahia':33000000,'Fluminense':30500000,'Atlético-MG':28000000,
 'Internacional':25500000,'Grêmio':23000000,'São Paulo':23000000,'Santos':20500000,
 'Vasco':18000000,'Athletico-PR':15500000,'Bragantino':15500000,'Vitória':5500000,
 'Coritiba':4000000,'Mirassol':4000000,'Chapecoense':4000000,'Remo':4000000
};
let transferBudget=0,transferHistory=[],careerFinished=false;
let incomingOffers=[],marketOfferSeq=0;
function initialBudget(club){return CLUB_BUDGETS[club?.name]??4000000;}
function availableBudget(){return Math.max(0,transferBudget-transferOffers.filter(o=>o.status==='pending'||o.status==='accepted'||o.status==='counter').reduce((n,o)=>n+o.amount,0));}
function transferMinimum(player,club){
 const importance=player.ovr>=83?1.7:player.ovr>=79?1.35:player.ovr>=75?1.15:1;
 return Math.ceil(player.value*importance/1000)*1000;
}
function playerInterest(player,club){
 const buyer=initialBudget(selectedClub),seller=initialBudget(club);
 if(player.ovr>=83&&buyer<30000000)return false;
 if(player.ovr>=80&&buyer<seller*.50)return false;
 return true;
}
function nextShirt(){const taken=new Set(squad.map(p=>p.shirtNumber));for(let n=1;n<=99;n++)if(!taken.has(n))return n;return null;}
function marketMessage(title,body){messages.unshift({title,text:body});renderMessagesDot();}
function finalizePurchase(offer){
 if(offer.status!=='accepted'&&offer.status!=='counter')return false;
 const roster=marketRosters[offer.clubId]||[];
 const index=roster.findIndex(p=>p.id===offer.playerId);
 if(index<0||offer.amount>transferBudget||!Number.isSafeInteger(offer.amount)||offer.amount<=0)return false;
 const player=roster[index],shirt=nextShirt();if(!shirt)return false;
 roster.splice(index,1);transferBudget-=offer.amount;
 squad.push({...player,starter:false,slot:squad.length,shirtNumber:shirt,condition:100});
 offer.status='completed';transferHistory.push({type:'compra',player:player.name,amount:offer.amount,club:offer.clubName,day});
 marketMessage(`Contratação concluída: ${player.name}`,`Você confirmou a compra por ${money(offer.amount)}. Jogador disponível no banco de reservas.`);
 renderSquad();return true;
}
function resolveOffer(offer){
 if(offer.status!=='pending')return;
 const club=clubs.find(c=>c.id===offer.clubId),player=(marketRosters[offer.clubId]||[]).find(p=>p.id===offer.playerId);
 if(!club||!player){offer.status='cancelled';return;}
 const minimum=transferMinimum(player,club);
 if(!playerInterest(player,club)){
  offer.status='rejected';marketMessage(`Negociação recusada: ${player.name}`,`O atleta não demonstrou interesse em jogar no ${selectedClub.name}.`);
 }else if(offer.amount<minimum*.72){
  offer.status='rejected';marketMessage(`Oferta recusada: ${player.name}`,`O ${club.name} recusou ${money(offer.amount)} por estar muito abaixo do esperado (${money(minimum)}).`);
 }else if(offer.amount<minimum){
  offer.status='counter';offer.amount=minimum;marketMessage(`Contraproposta por ${player.name}`,`O ${club.name} pede ${money(minimum)}. Abra Mercado > Minhas negociações para aceitar ou fazer nova oferta.`);
 }else{
  offer.status='accepted';marketMessage(`Proposta aceita: ${player.name}`,`O ${club.name} aceitou ${money(offer.amount)}. Confirme a contratação em Mercado > Minhas negociações.`);
 }
 toast('Nova resposta do dirigente!');
}
function resolveDueOffers(){transferOffers.filter(o=>o.status==='pending'&&marketClock>=o.dueAt).forEach(resolveOffer);}
function cancelOffer(o){if(!['pending','accepted','counter'].includes(o.status))return;o.status='cancelled';marketMessage(`Negociação encerrada: ${o.playerName}`,'Nenhum valor foi descontado.');showMarketNegotiations();}
function acceptOffer(o){
 if(!['accepted','counter'].includes(o.status))return;
 if(o.amount>transferBudget||o.amount>availableBudget()+o.amount){toast('Orçamento insuficiente para concluir.');return;}
 if(!finalizePurchase(o)){toast('Não foi possível concluir a compra.');return;}
 showMarketNegotiations();
}
function renegotiateOffer(o){
 if(!['counter','rejected','accepted'].includes(o.status))return;
 const value=Number(document.querySelector(`[data-new-amount="${o.id}"]`)?.value);
 const reserved=transferOffers.filter(x=>x!==o&&['pending','accepted','counter'].includes(x.status)).reduce((n,x)=>n+x.amount,0);
 if(!Number.isSafeInteger(value)||value<=0||value>transferBudget-reserved){toast('Oferta inválida ou acima do orçamento disponível.');return;}
 o.amount=value;o.status='pending';o.dueAt=marketClock+60;
 marketMessage(`Nova proposta: ${o.playerName}`,`Valor atualizado para ${money(value)}. Resposta em aproximadamente um minuto.`);
 showMarketNegotiations();
}
function showMarketNegotiations(){
 resolveDueOffers();
 const outgoing=transferOffers.slice().reverse().map(o=>`<div class="list-row market-negotiation"><div><strong>${escapeHtml(o.playerName)}</strong><br><small>${escapeHtml(o.clubName)} • ${money(o.amount)} • ${({'pending':'Aguardando dirigente','accepted':'Oferta aceita','counter':'Contraproposta','rejected':'Recusada','completed':'Contratado','cancelled':'Encerrada'})[o.status]||o.status}</small></div><div class="market-negotiation-actions">${['accepted','counter'].includes(o.status)?`<button class="primary-button" data-accept-offer="${o.id}">CONFIRMAR COMPRA</button>`:''}${['counter','rejected','accepted'].includes(o.status)?`<button class="secondary-button" data-show-renegotiate="${o.id}">NOVA PROPOSTA</button><div class="market-new-offer hidden" data-renegotiate-box="${o.id}"><input type="number" min="1" step="1" data-new-amount="${o.id}" placeholder="Valor (R$)"><button class="secondary-button" data-renegotiate="${o.id}">ENVIAR</button></div>`:''}${['pending','accepted','counter'].includes(o.status)?`<button class="secondary-button" data-cancel-offer="${o.id}">ENCERRAR</button>`:''}</div></div>`).join('');
 const inbound=incomingOffers.slice().reverse().map(o=>`<div class="list-row market-negotiation"><div><strong>${escapeHtml(o.playerName)}</strong><br><small>${escapeHtml(o.clubName)} oferece ${money(o.amount)} • ${({'pending':'Aguardando resposta','counter':'Sua contraproposta enviada','completed':'Vendido','rejected':'Recusada','cancelled':'Encerrada'})[o.status]||o.status}</small></div><div class="market-negotiation-actions">${o.status==='pending'?`<button class="primary-button" data-sell-accept="${o.id}">ACEITAR</button><input type="number" min="1" step="1" data-sell-value="${o.id}" placeholder="Pedir mais (R$)"><button class="secondary-button" data-sell-counter="${o.id}">PEDIR MAIS</button><button class="secondary-button" data-sell-reject="${o.id}">RECUSAR</button>`:''}</div></div>`).join('');
 openModal(`<h2>Negociações do dirigente</h2><p class="modal-sub">As respostas chegam em um minuto do relógio da campanha. Use AVANÇAR 1 MINUTO para acelerar. Compras só são concluídas após sua confirmação.</p><h3>Propostas enviadas</h3><div class="simple-list">${outgoing||'<p>Nenhuma proposta enviada.</p>'}</div><h3>Propostas recebidas</h3><div class="simple-list">${inbound||'<p>Nenhuma oferta recebida.</p>'}</div><div class="modal-actions"><button id="market-neg-back" class="secondary-button">VOLTAR AO MERCADO</button></div>`);
 document.querySelector('#market-neg-back').onclick=showMarketClubs;
 document.querySelectorAll('[data-accept-offer]').forEach(b=>b.onclick=()=>acceptOffer(transferOffers.find(o=>o.id===Number(b.dataset.acceptOffer))));
 document.querySelectorAll('[data-show-renegotiate]').forEach(b=>b.onclick=()=>document.querySelector(`[data-renegotiate-box="${b.dataset.showRenegotiate}"]`)?.classList.toggle('hidden'));
 document.querySelectorAll('[data-renegotiate]').forEach(b=>b.onclick=()=>renegotiateOffer(transferOffers.find(o=>o.id===Number(b.dataset.renegotiate))));
 document.querySelectorAll('[data-cancel-offer]').forEach(b=>b.onclick=()=>cancelOffer(transferOffers.find(o=>o.id===Number(b.dataset.cancelOffer))));
 document.querySelectorAll('[data-sell-accept]').forEach(b=>b.onclick=()=>respondIncoming(Number(b.dataset.sellAccept),'accept'));
 document.querySelectorAll('[data-sell-reject]').forEach(b=>b.onclick=()=>respondIncoming(Number(b.dataset.sellReject),'reject'));
 document.querySelectorAll('[data-sell-counter]').forEach(b=>b.onclick=()=>respondIncoming(Number(b.dataset.sellCounter),'counter'));
}
function respondIncoming(id,action){
 const o=incomingOffers.find(x=>x.id===id);if(!o||o.status!=='pending')return;
 const p=squad.find(x=>x.id===o.playerId);if(!p){o.status='cancelled';showMarketNegotiations();return;}
 if(action==='reject'){o.status='rejected';marketMessage(`Venda recusada: ${p.name}`,`Você recusou a oferta do ${o.clubName}.`);}
 else if(action==='counter'){
  const value=Number(document.querySelector(`[data-sell-value="${id}"]`)?.value);
  if(!Number.isSafeInteger(value)||value<=o.amount){toast('Peça um valor inteiro maior que a oferta recebida.');return;}
  o.status='counter';o.counterAmount=value;o.dueAt=marketClock+60;
  marketMessage(`Contraproposta enviada: ${p.name}`,`Você pediu ${money(value)} ao ${o.clubName}.`);
 }else{
  if(squad.length<=11){toast('Você precisa manter ao menos 11 jogadores.');return;}
  const buyer=clubs.find(c=>c.id===o.clubId);if(!buyer){o.status='cancelled';return;}
  const slot=squad.indexOf(p);squad.splice(slot,1);p.starter=false;p.slot=0;
  (marketRosters[buyer.id]??=[]).push(p);transferBudget+=o.amount;o.status='completed';
  transferHistory.push({type:'venda',player:p.name,amount:o.amount,club:buyer.name,day});
  marketMessage(`Venda concluída: ${p.name}`,`${money(o.amount)} adicionados ao orçamento. O jogador foi transferido ao ${buyer.name}.`);
  renderSquad();
 }
 showMarketNegotiations();
}
function generateIncomingOffer(){
 if(!selectedClub||careerFinished||day<3||incomingOffers.some(o=>o.status==='pending'||o.status==='counter'))return;
 const candidates=squad.filter(p=>!p.starter&&p.ovr>=68);
 if(!candidates.length)return;
 const buyers=clubs.filter(c=>c.id!==selectedClub.id&&initialBudget(c)>5000000);
 if(!buyers.length)return;
 const p=candidates[(day*7)%candidates.length],buyer=buyers[(day*3)%buyers.length];
 if(incomingOffers.some(o=>o.playerId===p.id&&o.status!=='rejected'))return;
 const amount=Math.ceil(p.value*(.85+((day%4)*.07))/1000)*1000;
 const o={id:++marketOfferSeq,playerId:p.id,playerName:p.name,clubId:buyer.id,clubName:buyer.name,amount,status:'pending'};
 incomingOffers.push(o);marketMessage(`Proposta recebida por ${p.name}`,`${buyer.name} oferece ${money(amount)}. Responda em Mercado > Minhas negociações.`);
}
function resolveIncomingCounters(){
 incomingOffers.filter(o=>o.status==='counter'&&marketClock>=o.dueAt).forEach(o=>{
  const p=squad.find(x=>x.id===o.playerId);
  if(!p){o.status='cancelled';return;}
  if(o.counterAmount<=Math.ceil(o.amount*1.18)){
   o.amount=o.counterAmount;o.status='pending';marketMessage(`Contraproposta aceita: ${p.name}`,`${o.clubName} aceitou pagar ${money(o.amount)}. Confirme a venda em Minhas negociações.`);
  }else{o.status='rejected';marketMessage(`Contraproposta recusada: ${p.name}`,`${o.clubName} não aceitou pagar ${money(o.counterAmount)}.`);}
 });
}
let marketRosters = {};
let realRostersLoaded = false;
const groupToPos = {GOLEIRO:'GOL',ZAGUEIRO:'ZAG',LATERAL:'LAT',DEFENSOR:'ZAG',VOLANTE:'VOL',MEIA:'MC',MEIO_CAMPO:'MC',ATACANTE:'ATA'};
// Avaliações de jogabilidade (não oficiais). Faixas por função, com destaques revisados.
const ratingOverrides = {
  'internacional|alan patrick':85,
  'atletico-mg|hulk':85,
  'santos|neymar':86,
  'flamengo|arrascaeta':87,
  'flamengo|pedro':84,
  'palmeiras|vitor roque':84,
  'cruzeiro|matheus pereira':84,
  'bahia|everton ribeiro':81,
  'sao paulo|lucas moura':82,
  'fluminense|ganso':80,
  'corinthians|yuri alberto':81
};
const posBaseline={GOL:69,ZAG:69,LAT:68,VOL:69,MC:70,ATA:70};
function normalizedName(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
// PARTE 5: atributos distintos por função. Valores ainda estimados, não oficiais.
const FIELD_ATTRIBUTES = ['passe','finalizacao','drible','dominio','cruzamento','bola_parada','desarme','marcacao','interceptacao','posicionamento_defensivo','jogo_aereo','velocidade','aceleracao','forca','resistencia','visao','frieza'];
const GOALKEEPER_ATTRIBUTES = ['reflexos','defesa_chutes','posicionamento_goleiro','saida_gol','jogo_aereo_goleiro','um_contra_um','reposicao','penaltis','resistencia','forca','frieza'];
const ATTRIBUTE_LABELS={passe:'Passe',finalizacao:'Finalização',drible:'Drible',dominio:'Domínio',cruzamento:'Cruzamento',bola_parada:'Bola parada',desarme:'Desarme',marcacao:'Marcação',interceptacao:'Interceptação',posicionamento_defensivo:'Posicionamento defensivo',jogo_aereo:'Jogo aéreo',velocidade:'Velocidade',aceleracao:'Aceleração',forca:'Força',resistencia:'Resistência',visao:'Visão de jogo',frieza:'Frieza',reflexos:'Reflexos',defesa_chutes:'Defesa de chutes',posicionamento_goleiro:'Posicionamento (goleiro)',saida_gol:'Saída do gol',jogo_aereo_goleiro:'Jogo aéreo (goleiro)',um_contra_um:'Um contra um',reposicao:'Reposição',penaltis:'Pênaltis'};
const ATTRIBUTE_BONUSES={
 GOL:{reflexos:10,defesa_chutes:9,posicionamento_goleiro:8,saida_gol:5,jogo_aereo_goleiro:5,um_contra_um:7,reposicao:1,penaltis:3,resistencia:0,forca:1,frieza:2},
 ZAG:{desarme:9,marcacao:10,interceptacao:8,posicionamento_defensivo:9,jogo_aereo:8,forca:6,finalizacao:-19,drible:-12},
 LAT:{velocidade:7,aceleracao:7,cruzamento:6,resistencia:7,marcacao:3,desarme:3,finalizacao:-13},
 VOL:{desarme:8,marcacao:7,interceptacao:8,posicionamento_defensivo:7,passe:4,visao:3,finalizacao:-12},
 MC:{passe:9,visao:9,dominio:7,drible:4,bola_parada:4,marcacao:-6,desarme:-7},
 ATA:{finalizacao:10,drible:7,aceleracao:6,velocidade:6,dominio:6,frieza:5,marcacao:-20,desarme:-21}
};
// Perfil técnico de jogabilidade estimado, não extraído de FIFA/PES/FM.
// OVR é o valor fornecido pelo usuário; atributos são distribuídos conforme a função.
const ATTRIBUTE_PROFILES={
 GOL:{reflexos:7,defesa_chutes:6,posicionamento_goleiro:5,saida_gol:1,jogo_aereo_goleiro:2,um_contra_um:4,reposicao:-6,penaltis:-2,resistencia:-9,forca:-5,frieza:0},
 ZAG:{desarme:7,marcacao:9,interceptacao:7,posicionamento_defensivo:8,jogo_aereo:6,forca:5,passe:-8,finalizacao:-35,drible:-22,dominio:-10,cruzamento:-22,bola_parada:-23,velocidade:-10,aceleracao:-10,visao:-9},
 LAT:{velocidade:6,aceleracao:6,cruzamento:4,resistencia:7,marcacao:3,desarme:3,interceptacao:1,posicionamento_defensivo:2,finalizacao:-26,bola_parada:-15,jogo_aereo:-9,forca:-5},
 VOL:{desarme:6,marcacao:5,interceptacao:6,posicionamento_defensivo:5,passe:3,visao:0,finalizacao:-25,drible:-10,cruzamento:-13,bola_parada:-14,velocidade:-6},
 MC:{passe:9,visao:9,dominio:7,drible:5,bola_parada:4,frieza:4,marcacao:-22,desarme:-26,interceptacao:-18,posicionamento_defensivo:-19,jogo_aereo:-14,forca:-9,finalizacao:-2},
 ATA:{finalizacao:9,drible:5,aceleracao:6,velocidade:5,dominio:5,frieza:5,marcacao:-33,desarme:-36,interceptacao:-30,posicionamento_defensivo:-32,bola_parada:-9}
};
function technicalAttributes(pos,ovr,seed,revised=false){
 if(!revised){const keys=pos==='GOL'?GOALKEEPER_ATTRIBUTES:FIELD_ATTRIBUTES;return Object.fromEntries(keys.map((key,i)=>{const variation=((seed >>> ((i%4)*7))%9)-4;return [key,Math.max(20,Math.min(95,Math.round(ovr+(ATTRIBUTE_BONUSES[pos]?.[key]||0)+variation)))];}));}
 const keys=pos==='GOL'?GOALKEEPER_ATTRIBUTES:FIELD_ATTRIBUTES;
 const profile=ATTRIBUTE_PROFILES[pos]||ATTRIBUTE_PROFILES.MC;
 return Object.fromEntries(keys.map((key,i)=>{
   const variation=((seed >>> ((i%4)*7))%7)-3;
   return [key,Math.max(20,Math.min(95,Math.round(ovr+(profile[key]??-4)+variation)))];
 }));
}
// Eficiência de cada ação: atributos pertinentes, moral, energia, treino e adaptação.
function energyEfficiency(energy){
 const e=Math.max(0,Math.min(100,Number(energy)||0));
 if(e>=80)return 1;
 if(e>=60)return 1-(80-e)*.0025;
 if(e>=40)return .95-(60-e)*.005;
 if(e>=20)return .85-(40-e)*.0075;
 return .70-(20-e)*.0075;
}
function moraleEfficiency(value){const m=Math.max(0,Math.min(100,Number(value)||0));return m>=85?1.03+(m-85)*.002:m>=65?1.01+(m-65)*.001:m>=40?1:m>=20?1-(40-m)*.003: .94-m*.002;}
function positionCompatibility(natural,assigned){
 if(!assigned||natural===assigned)return 1;
 const related={ZAG:['VOL','LAT'],LAT:['ZAG','VOL'],VOL:['ZAG','MC','LAT'],MC:['VOL','ATA'],ATA:['MC','LAT'],GOL:[]};
 if(natural==='GOL'||assigned==='GOL')return .35;
 return (related[natural]||[]).includes(assigned)?.95:.75;
}
function effectiveAttribute(player,key,assignedPosition){
 const base=Number(player.attributes?.[key]||20);
 const bonus=0; // Parte 17: evolução incorporada permanentemente ao atributo base
 return Math.max(1,Math.min(99,base*(1+bonus)*energyEfficiency(player.condition)*moraleEfficiency(player.morale??60)*positionCompatibility(player.pos,assignedPosition)));
}
// PARTE 9 — treinos por especialidade, experiência permanente e recuperação diária.
const TRAINING_TYPES={
 finalizacao:{label:'Finalização',keys:['finalizacao','frieza','dominio'],bonus:.035,cost:12},
 construcao:{label:'Construção de jogadas',keys:['passe','visao','dominio','drible'],bonus:.03,cost:11},
 defesa:{label:'Defensivo',keys:['desarme','marcacao','interceptacao','posicionamento_defensivo','jogo_aereo'],bonus:.03,cost:12},
 fisico:{label:'Físico',keys:['resistencia','forca','velocidade','aceleracao'],bonus:.02,cost:17},
 tatico:{label:'Tático',keys:['visao','frieza','posicionamento_defensivo','passe'],bonus:.03,cost:8},
 goleiros:{label:'Goleiros',keys:['reflexos','defesa_chutes','posicionamento_goleiro','saida_gol','um_contra_um','penaltis'],bonus:.035,cost:12},
 recuperacao:{label:'Recuperação',keys:[],bonus:0,cost:-20}
};
let trainingType='construcao';
function clamp100(v){return Math.max(0,Math.min(100,Math.round(v*10)/10));}
function injuryRemaining(p){return Math.max(0,(p.injuredUntil||0)-day);}
function suspensionRemaining(p){return Math.max(0,p.suspensionMatches||0);}
function playerAvailable(p){return !injuryRemaining(p)&&!suspensionRemaining(p);}
function matchDiscipline(p){if(!p.matchDiscipline)p.matchDiscipline={yellow:0,red:false};return p.matchDiscipline;}
function applyMatchSanctions(m){
 // Processa somente atletas do clube controlado, uma única vez no apito final.
 if(m.sanctionsApplied)return;m.sanctionsApplied=true;
 squad.forEach(p=>{
  const d=p.matchDiscipline||{yellow:0,red:false};
  if(d.red){p.suspensionMatches=Math.max(p.suspensionMatches||0,1);p.redCards=(p.redCards||0)+1;}
  else if(d.yellow){p.yellowCards=(p.yellowCards||0)+1;if(p.yellowCards>=3){p.yellowCards=0;p.suspensionMatches=Math.max(p.suspensionMatches||0,1);}}
  p.matchDiscipline={yellow:0,red:false};
 });
}
function processSuspensionsAfterMatch(m){
 // Suspensões antigas são cumpridas nesta rodada; as novas só valem na próxima.
 const old=m.suspendedAtKickoff||[];
 old.forEach(id=>{const p=squad.find(x=>x.id===id);if(p)p.suspensionMatches=Math.max(0,(p.suspensionMatches||0)-1);});
}
function matchInjury(victim,source){
 const m=liveMatch;if(!m||m.phase!=='running'||!victim)return false;
 const exhausted=(victim.condition||100)<30;
 const risk=(source==='foul'?.024:.002)*(exhausted?2.3:1);
 if(Math.random()>=risk)return false;
 const severity=Math.random(),matches=severity<.65?1:severity<.9?2:3;
 victim.injuredUntil=day+matches*3+1;
 victim.injury=`Lesão em partida — previsão de ${matches} jogo(s) (aproximada)`;
 matchEvent(`LESÃO! ${victim.name} sente dores e não pode continuar. Previsão: ${matches} jogo(s).`);
 if(squad.includes(victim)){victim.starter=false;m.injuredIds.add(victim.id);}
 else m.cpu=m.cpu.filter(p=>p!==victim);
 return true;
}

function recoverTrainingDay(){
 squad.forEach(p=>{
   const yesterdayTrained=lastTrainingDay[p.id]===day-1;
   const recovery=yesterdayTrained?8:16;
   p.condition=clamp100(p.condition+recovery);
   if(p.injuredUntil&&p.injuredUntil<=day){p.injuredUntil=0;p.injury='Recuperado';}
 });
}
function applyTraining(p,type){
 const spec=TRAINING_TYPES[type];const before=p.condition;
 p.trainCount=(p.trainCount||0)+1;
 lastTrainingDay[p.id]=day;
 if(type==='recuperacao'){
   p.condition=clamp100(before+20);
   return `${p.name}: recuperação +${Math.round(p.condition-before)} de energia`;
 }
 p.condition=clamp100(before-spec.cost);
 const relevant=spec.keys.filter(key=>Object.hasOwn(p.attributes||{},key));
 const changes=[];
 for(const key of relevant){
   const old=Number(p.attributes[key]);
   const gain=Math.max(1,Math.round(old*spec.bonus));
   const updated=Math.min(99,old+gain);
   p.attributes[key]=updated;
   changes.push(`${ATTRIBUTE_LABELS[key]||key}: ${old} → ${updated}`);
 }
 p.lastTrainingChanges=changes;
 // Lesão é rara em condição normal; fadiga acumulada aumenta o risco.
 const risk=before<25?.055:before<45?.025:before<65?.009:.002;
 if(Math.random()<risk){
   const days=before<35?2+Math.floor(Math.random()*3):1+Math.floor(Math.random()*2);
   p.injuredUntil=day+days+1;p.injury=`Lesão no treino — ${days} dia(s) de afastamento`;
   if(p.starter){
     const reserve=squad.find(x=>!x.starter&&playerAvailable(x)&&x.pos===p.pos)||squad.find(x=>!x.starter&&playerAvailable(x));
     if(reserve){p.starter=false;reserve.starter=true;reserve.slot=p.slot;}
   }
   return `${p.name}: lesão no treino (${days} dia(s) de afastamento)`;
 }
 return `${p.name}: -${spec.cost} energia; atributos atualizados: ${changes.length ? changes.join(", ") : "nenhum"}`;
}
function consumeMatchTrainingBonus(){ /* Ganhos permanentes até o encerramento da campanha. */ }
function gamePlayer(p,index){
  const group=String(p.posicao_grupo||'').toUpperCase();
  const pos=groupToPos[group]||(group.includes('GOL')?'GOL':group.includes('LAT')?'LAT':group.includes('ZAG')||group.includes('DEF')?'ZAG':group.includes('VOL')?'VOL':group.includes('MEI')?'MC':'ATA');
  const seed=[...p.id].reduce((n,ch)=>(n*31+ch.charCodeAt(0))>>>0,17);
  const clubName=({1:'athletico-pr',2:'atletico-mg',3:'bahia',4:'botafogo',5:'bragantino',6:'chapecoense',7:'corinthians',8:'coritiba',9:'cruzeiro',10:'flamengo',11:'fluminense',12:'gremio',13:'internacional',14:'mirassol',15:'palmeiras',16:'remo',17:'santos',18:'sao paulo',19:'vasco',20:'vitoria'})[p.clube_id];
  const ratingKey=clubName+'|'+normalizedName(p.nome);
  const ovr=Number.isInteger(p.ovr_usuario)?p.ovr_usuario:(ratingOverrides[ratingKey]??Math.min(79,posBaseline[pos]+(seed%11)-4));
  const age=Number.isInteger(p.idade)?p.idade:20+(seed%15);
  return {id:index+1,sourceId:p.id,name:p.nome,pos,ovr,age,salary:45000+(ovr-60)*8500,value:700000+(ovr-60)*260000,
    emoji:pos==='GOL'?'🧤':'⚽',condition:100,morale:60,trainingBonuses:{},attributeXP:{},trainingUntil:{},injuredUntil:0,suspensionMatches:0,redCards:0,matchDiscipline:{yellow:0,red:false},starter:false,slot:index,injury:'Sem informação médica verificada',
    goals:0,assists:0,seasonGoals:0,seasonAssists:0,attributes:technicalAttributes(pos,ovr,seed,true),verified:false};
}
// Banco incorporado para funcionar tambem em file://, sem fetch de elencos.json.
const embeddedRosters = [{"id":"athletico-pr-001-stiven-mendoza","nome":"Stiven Mendoza","clube_id":1,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"athletico-pr-002-kevin-viveros","nome":"Kevin Viveros","clube_id":1,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-003-kerwin-vargas","nome":"Kerwin Vargas","clube_id":1,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"athletico-pr-004-jorge-rivaldo","nome":"Jorge Rivaldo","clube_id":1,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-005-leozinho","nome":"Leozinho","clube_id":1,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-006-felipe-chiqueti","nome":"Felipe Chiqueti","clube_id":1,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-007-renan-viana","nome":"Renan Viana","clube_id":1,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-008-renan-peixoto","nome":"Renan Peixoto","clube_id":1,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-009-felipinho","nome":"Felipinho","clube_id":1,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":70},{"id":"athletico-pr-010-joao-cruz","nome":"João Cruz","clube_id":1,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-011-bruno-zapelli","nome":"Bruno Zapelli","clube_id":1,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"athletico-pr-012-luiz-gustavo","nome":"Luiz Gustavo","clube_id":1,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-013-jadson","nome":"Jadson","clube_id":1,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":69},{"id":"athletico-pr-014-alejandro-garcia","nome":"Alejandro García","clube_id":1,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-015-juan-portilla","nome":"Juan Portilla","clube_id":1,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":71},{"id":"athletico-pr-016-dudu-kogitzki","nome":"Dudu Kogitzki","clube_id":1,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-017-riquelme","nome":"Riquelme","clube_id":1,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-018-gilberto-dos-santos","nome":"Gilberto dos Santos","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"athletico-pr-019-leo-pele","nome":"Léo Pelé","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-020-arthur-dias","nome":"Arthur Dias","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-021-leo-derik","nome":"Léo Derik","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-022-gilberto-moraes","nome":"Gilberto Moraes","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-023-carlos-teran","nome":"Carlos Terán","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-024-dantas","nome":"Dantas","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-025-claudinho","nome":"Claudinho","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-026-gaston-benavidez","nome":"Gastón Benavídez","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"athletico-pr-027-juan-felipe-aguirre","nome":"Juan Felipe Aguirre","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"athletico-pr-028-lucas-esquivel","nome":"Lucas Esquivel","clube_id":1,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":72},{"id":"athletico-pr-029-mycael","nome":"Mycael","clube_id":1,"posicao_grupo":"GOLEIRO","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"athletico-pr-030-santos","nome":"Santos","clube_id":1,"posicao_grupo":"GOLEIRO","idade":null,"vinculo":"pendente_de_validacao"},{"id":"athletico-pr-031-matheus-soares","nome":"Matheus Soares","clube_id":1,"posicao_grupo":"GOLEIRO","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-001-everson","nome":"Everson","clube_id":2,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-002-gabriel-delfim","nome":"Gabriel Delfim","clube_id":2,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-003-pedro-cobra","nome":"Pedro Cobra","clube_id":2,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-004-robert","nome":"Robert","clube_id":2,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-005-preciado","nome":"Preciado","clube_id":2,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-006-pascini","nome":"Pascini","clube_id":2,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-007-natanael","nome":"Natanael","clube_id":2,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-008-renan-lodi","nome":"Renan Lodi","clube_id":2,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-009-leo-duarte","nome":"Léo Duarte","clube_id":2,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-010-lyanco","nome":"Lyanco","clube_id":2,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-011-lemos","nome":"Lemos","clube_id":2,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-012-ruan-tressoldi","nome":"Ruan Tressoldi","clube_id":2,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-013-samuel","nome":"Samuel","clube_id":2,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-014-vitao","nome":"Vitão","clube_id":2,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-015-vitor-hugo","nome":"Vitor Hugo","clube_id":2,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-016-alexsander","nome":"Alexsander","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-017-bernard","nome":"Bernard","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-018-cisse","nome":"Cissé","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-019-alan-franco","nome":"Alan Franco","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-020-fred","nome":"Fred","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-021-gustavo-scarpa","nome":"Gustavo Scarpa","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-022-gutte","nome":"Gutte","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-023-igor-gomes","nome":"Igor Gomes","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-024-indio","nome":"Índio","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-025-kevin-castano","nome":"Kevin Castaño","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-026-maycon","nome":"Maycon","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-027-reinier","nome":"Reinier","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-028-tomas-perez","nome":"Tomás Pérez","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-029-victor-hugo","nome":"Victor Hugo","clube_id":2,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-030-cassierra","nome":"Cassierra","clube_id":2,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-031-caua-soares","nome":"Cauã Soares","clube_id":2,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-032-cuello","nome":"Cuello","clube_id":2,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-033-dudu","nome":"Dudu","clube_id":2,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-034-alan-minda","nome":"Alan Minda","clube_id":2,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"atletico-mg-035-thiago-borbas","nome":"Thiago Borbas","clube_id":2,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-001-ronaldo","nome":"Ronaldo","clube_id":3,"posicao_grupo":"GOLEIRO","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"bahia-002-leo-vieira","nome":"Léo Vieira","clube_id":3,"posicao_grupo":"GOLEIRO","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-003-guido-herrera","nome":"Guido Herrera","clube_id":3,"posicao_grupo":"GOLEIRO","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-004-ze-guilherme","nome":"Zé Guilherme","clube_id":3,"posicao_grupo":"LATERAL","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-005-roman-gomez","nome":"Roman Gomez","clube_id":3,"posicao_grupo":"LATERAL","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-006-luciano-juba","nome":"Luciano Juba","clube_id":3,"posicao_grupo":"LATERAL","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"bahia-007-david-duarte","nome":"David Duarte","clube_id":3,"posicao_grupo":"ZAGUEIRO","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-008-marcos-victor","nome":"Marcos Victor","clube_id":3,"posicao_grupo":"ZAGUEIRO","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":72},{"id":"bahia-009-luiz-gustavo","nome":"Luiz Gustavo","clube_id":3,"posicao_grupo":"ZAGUEIRO","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-010-marco-moreno","nome":"Marco Moreno","clube_id":3,"posicao_grupo":"ZAGUEIRO","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-011-kanu","nome":"Kanu","clube_id":3,"posicao_grupo":"ZAGUEIRO","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"bahia-012-everton-ribeiro","nome":"Everton Ribeiro","clube_id":3,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"bahia-013-nicolas-acevedo","nome":"Nicolás Acevedo","clube_id":3,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"bahia-014-david-martins","nome":"David Martins","clube_id":3,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-015-erick","nome":"Erick","clube_id":3,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"bahia-016-rodrigo-nestor","nome":"Rodrigo Nestor","clube_id":3,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"bahia-017-michel-araujo","nome":"Michel Araujo","clube_id":3,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-018-lautaro-lopez","nome":"Lautaro Lopez","clube_id":3,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-019-caio-alexandre","nome":"Caio Alexandre","clube_id":3,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-020-jean-lucas","nome":"Jean Lucas","clube_id":3,"posicao_grupo":"MEIA","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"bahia-021-ademir","nome":"Ademir","clube_id":3,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"bahia-022-ruan-pablo","nome":"Ruan Pablo","clube_id":3,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-023-erick-pulga","nome":"Erick Pulga","clube_id":3,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"bahia-024-willian-jose","nome":"Willian José","clube_id":3,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"bahia-025-sanabria","nome":"Sanabria","clube_id":3,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-026-kaue-furquim","nome":"Kauê Furquim","clube_id":3,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-027-kike-olivera","nome":"Kike Olivera","clube_id":3,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-028-alejo-veliz","nome":"Alejo Veliz","clube_id":3,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bahia-029-everaldo","nome":"Everaldo","clube_id":3,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"pendente_de_validacao"},{"id":"botafogo-001-gabriel-batista","nome":"Gabriel Batista","clube_id":4,"posicao_grupo":"GOLEIRO","idade":28,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"botafogo-002-warleson","nome":"Warleson","clube_id":4,"posicao_grupo":"GOLEIRO","idade":30,"vinculo":"pendente_de_validacao"},{"id":"botafogo-003-alex-telles","nome":"Alex Telles","clube_id":4,"posicao_grupo":"DEFENSOR","idade":33,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"botafogo-004-anthony","nome":"Anthony","clube_id":4,"posicao_grupo":"DEFENSOR","idade":21,"vinculo":"pendente_de_validacao"},{"id":"botafogo-005-arthur-chaves","nome":"Arthur Chaves","clube_id":4,"posicao_grupo":"DEFENSOR","idade":25,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"botafogo-006-nahuel-ferraresi","nome":"Nahuel Ferraresi","clube_id":4,"posicao_grupo":"DEFENSOR","idade":28,"vinculo":"pendente_de_validacao"},{"id":"botafogo-007-gabriel-justino","nome":"Gabriel Justino","clube_id":4,"posicao_grupo":"DEFENSOR","idade":20,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"botafogo-008-kadu","nome":"Kadu","clube_id":4,"posicao_grupo":"DEFENSOR","idade":21,"vinculo":"pendente_de_validacao"},{"id":"botafogo-009-kaio-pantaleao","nome":"Kaio Pantaleão","clube_id":4,"posicao_grupo":"DEFENSOR","idade":31,"vinculo":"pendente_de_validacao"},{"id":"botafogo-010-lucas-monzon","nome":"Lucas Monzón","clube_id":4,"posicao_grupo":"DEFENSOR","idade":25,"vinculo":"pendente_de_validacao"},{"id":"botafogo-011-marcal","nome":"Marçal","clube_id":4,"posicao_grupo":"DEFENSOR","idade":37,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"botafogo-012-mateo-ponte","nome":"Mateo Ponte","clube_id":4,"posicao_grupo":"DEFENSOR","idade":23,"vinculo":"pendente_de_validacao"},{"id":"botafogo-013-paulo-victor","nome":"Paulo Victor","clube_id":4,"posicao_grupo":"DEFENSOR","idade":31,"vinculo":"pendente_de_validacao"},{"id":"botafogo-014-vitinho","nome":"Vitinho","clube_id":4,"posicao_grupo":"DEFENSOR","idade":27,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"botafogo-015-allan","nome":"Allan","clube_id":4,"posicao_grupo":"MEIO-CAMPISTA","idade":33,"vinculo":"pendente_de_validacao"},{"id":"botafogo-016-alvaro-montoro","nome":"Álvaro Montoro","clube_id":4,"posicao_grupo":"MEIO-CAMPISTA","idade":19,"vinculo":"pendente_de_validacao"},{"id":"botafogo-017-cristian-medina","nome":"Cristian Medina","clube_id":4,"posicao_grupo":"MEIO-CAMPISTA","idade":24,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"botafogo-018-danilo","nome":"Danilo","clube_id":4,"posicao_grupo":"MEIO-CAMPISTA","idade":25,"vinculo":"pendente_de_validacao"},{"id":"botafogo-019-domingos-andrade","nome":"Domingos Andrade","clube_id":4,"posicao_grupo":"MEIO-CAMPISTA","idade":23,"vinculo":"pendente_de_validacao"},{"id":"botafogo-020-edenilson","nome":"Edenilson","clube_id":4,"posicao_grupo":"MEIO-CAMPISTA","idade":36,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"botafogo-021-huguinho","nome":"Huguinho","clube_id":4,"posicao_grupo":"MEIO-CAMPISTA","idade":19,"vinculo":"pendente_de_validacao","ovr_usuario":71},{"id":"botafogo-022-jordan-barrera","nome":"Jordan Barrera","clube_id":4,"posicao_grupo":"MEIO-CAMPISTA","idade":20,"vinculo":"pendente_de_validacao"},{"id":"botafogo-023-hakim-ziyech","nome":"Hakim Ziyech","clube_id":4,"posicao_grupo":"MEIO-CAMPISTA","idade":33,"vinculo":"pendente_de_validacao"},{"id":"botafogo-024-danilo-pereira","nome":"Danilo Pereira","clube_id":4,"posicao_grupo":"ATACANTE","idade":27,"vinculo":"pendente_de_validacao"},{"id":"botafogo-025-kauan-toledo","nome":"Kauan Toledo","clube_id":4,"posicao_grupo":"ATACANTE","idade":20,"vinculo":"pendente_de_validacao"},{"id":"botafogo-026-lucas-emanuel","nome":"Lucas Emanuel","clube_id":4,"posicao_grupo":"ATACANTE","idade":17,"vinculo":"pendente_de_validacao"},{"id":"botafogo-027-matheus-martins","nome":"Matheus Martins","clube_id":4,"posicao_grupo":"ATACANTE","idade":23,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"botafogo-028-arthur-cabral","nome":"Arthur Cabral","clube_id":4,"posicao_grupo":"ATACANTE","idade":28,"vinculo":"pendente_de_validacao"},{"id":"botafogo-029-junior-santos","nome":"Júnior Santos","clube_id":4,"posicao_grupo":"ATACANTE","idade":32,"vinculo":"pendente_de_validacao"},{"id":"botafogo-030-kadir","nome":"Kadir","clube_id":4,"posicao_grupo":"ATACANTE","idade":19,"vinculo":"pendente_de_validacao"},{"id":"bragantino-001-cleiton","nome":"Cleiton","clube_id":5,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-002-tiago-volpi","nome":"Tiago Volpi","clube_id":5,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-003-fabricio","nome":"Fabrício","clube_id":5,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-004-gustavo-reis","nome":"Gustavo Reis","clube_id":5,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-005-guzman-rodriguez","nome":"Guzmán Rodríguez","clube_id":5,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"bragantino-006-eduardo-santos","nome":"Eduardo Santos","clube_id":5,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-007-alix-vinicius","nome":"Alix Vinícius","clube_id":5,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-008-vanderlan","nome":"Vanderlan","clube_id":5,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-009-gustavo-marques","nome":"Gustavo Marques","clube_id":5,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"bragantino-010-agustin-sant-anna","nome":"Agustín Sant’Anna","clube_id":5,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-011-juninho-capixaba","nome":"Juninho Capixaba","clube_id":5,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"bragantino-012-andres-hurtado","nome":"Andrés Hurtado","clube_id":5,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-013-caue-nascimento","nome":"Cauê Nascimento","clube_id":5,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-014-fabinho","nome":"Fabinho","clube_id":5,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":71},{"id":"bragantino-015-gabriel-girotto","nome":"Gabriel Girotto","clube_id":5,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-016-eric-ramires","nome":"Eric Ramires","clube_id":5,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-017-nacho-sosa","nome":"Nacho Sosa","clube_id":5,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-018-rodriguinho","nome":"Rodriguinho","clube_id":5,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-019-gustavo-neves","nome":"Gustavo Neves","clube_id":5,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-020-patrick-silva","nome":"Patrick Silva","clube_id":5,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-021-matheus-fernandes","nome":"Matheus Fernandes","clube_id":5,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-022-eduardo-sasha","nome":"Eduardo Sasha","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"bragantino-023-isidro-pitta","nome":"Isidro Pitta","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-024-fernando","nome":"Fernando","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-025-vinicinho","nome":"Vinicinho","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-026-bruno-goncalves","nome":"Bruno Gonçalves","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-027-lucas-barbosa","nome":"Lucas Barbosa","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-028-davi-gomes","nome":"Davi Gomes","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"bragantino-029-henry-mosquera","nome":"Henry Mosquera","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"bragantino-030-jose-maria-herrera","nome":"José María Herrera","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"bragantino-031-wallace-yan","nome":"Wallace Yan","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"bragantino-032-marcelinho-braz","nome":"Marcelinho Braz","clube_id":5,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-001-anderson","nome":"Anderson","clube_id":6,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-002-gabriel-werner","nome":"Gabriel Werner","clube_id":6,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-003-kaina","nome":"Kainã","clube_id":6,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-004-matheus-aurelio","nome":"Matheus Aurélio","clube_id":6,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-005-doma","nome":"Doma","clube_id":6,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-006-joao-paulo","nome":"João Paulo","clube_id":6,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-007-kauan","nome":"Kauan","clube_id":6,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-008-victor-caetano","nome":"Victor Caetano","clube_id":6,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-009-vinicius","nome":"Vinicius","clube_id":6,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-010-bruno-pacheco","nome":"Bruno Pacheco","clube_id":6,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-011-bruno-tubarao","nome":"Bruno Tubarão","clube_id":6,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-012-everton","nome":"Everton","clube_id":6,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-013-fernando","nome":"Fernando","clube_id":6,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-014-heitor","nome":"Heitor","clube_id":6,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-015-mancha","nome":"Mancha","clube_id":6,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-016-vinicius-balieiro","nome":"Vinicius Balieiro","clube_id":6,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-017-david","nome":"David","clube_id":6,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-018-camilo","nome":"Camilo","clube_id":6,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-019-rosivan","nome":"Rosivan","clube_id":6,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-020-rafael-carvalheira","nome":"Rafael Carvalheira","clube_id":6,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-021-giovanni-augusto","nome":"Giovanni Augusto","clube_id":6,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-022-max","nome":"Max","clube_id":6,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-023-miguel-carvalho","nome":"Miguel Carvalho","clube_id":6,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-024-robert","nome":"Robert","clube_id":6,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-025-yago-felipe","nome":"Yago Felipe","clube_id":6,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-026-dylan-borrero","nome":"Dylan Borrero","clube_id":6,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-027-franco-rossi","nome":"Franco Rossi","clube_id":6,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-028-marcinho","nome":"Marcinho","clube_id":6,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-029-mauricio-garcez","nome":"Maurício Garcez","clube_id":6,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-030-rubens","nome":"Rubens","clube_id":6,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"chapecoense-031-tulio-eduardo","nome":"Túlio Eduardo","clube_id":6,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-001-hugo-souza","nome":"Hugo Souza","clube_id":7,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"corinthians-002-felipe-longo","nome":"Felipe Longo","clube_id":7,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-003-kaue","nome":"Kauê","clube_id":7,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-004-matheuzinho","nome":"Matheuzinho","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"corinthians-005-gabriel-paulista","nome":"Gabriel Paulista","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-006-joao-pedro","nome":"João Pedro","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"corinthians-007-andre-ramalho","nome":"André Ramalho","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-008-gustavo-henrique","nome":"Gustavo Henrique","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"corinthians-009-pedro-milans","nome":"Pedro Milans","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-010-matheus-bidu","nome":"Matheus Bidu","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"corinthians-011-fabrizio-angileri","nome":"Fabrizio Angileri","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-012-hugo-farias","nome":"Hugo Farias","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-013-iago-machado","nome":"Iago Machado","clube_id":7,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-014-breno-bidon","nome":"Breno Bidon","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"corinthians-015-rodrigo-garro","nome":"Rodrigo Garro","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-016-vitinho","nome":"Vitinho","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"corinthians-017-raniele","nome":"Raniele","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-018-andre-carrillo","nome":"André Carrillo","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"corinthians-019-matheus-pereira","nome":"Matheus Pereira","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-020-allan","nome":"Allan","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-021-charles","nome":"Charles","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-022-andre","nome":"André","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-023-zakaria-labyad","nome":"Zakaria Labyad","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-024-luiz-gustavo","nome":"Luiz Gustavo","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-025-jesse-lingard","nome":"Jesse Lingard","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-026-alex-santana","nome":"Alex Santana","clube_id":7,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-027-yuri-alberto","nome":"Yuri Alberto","clube_id":7,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"corinthians-028-memphis-depay","nome":"Memphis Depay","clube_id":7,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"corinthians-029-pedro-raul","nome":"Pedro Raul","clube_id":7,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-030-kayke","nome":"Kayke","clube_id":7,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-031-kaio-cesar","nome":"Kaio César","clube_id":7,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"corinthians-032-gui-negao","nome":"Gui Negão","clube_id":7,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"corinthians-033-dieguinho","nome":"Dieguinho","clube_id":7,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"coritiba-001-pedro-morisco","nome":"Pedro Morisco","clube_id":8,"posicao_grupo":"Goleiro","idade":22,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"coritiba-002-keiller","nome":"Keiller","clube_id":8,"posicao_grupo":"Goleiro","idade":30,"vinculo":"pendente_de_validacao"},{"id":"coritiba-003-pedro-rangel","nome":"Pedro Rangel","clube_id":8,"posicao_grupo":"Goleiro","idade":26,"vinculo":"pendente_de_validacao"},{"id":"coritiba-004-benassi","nome":"Benassi","clube_id":8,"posicao_grupo":"Goleiro","idade":22,"vinculo":"pendente_de_validacao"},{"id":"coritiba-005-tinga","nome":"Tinga","clube_id":8,"posicao_grupo":"Defensor","idade":33,"vinculo":"pendente_de_validacao","ovr_usuario":70},{"id":"coritiba-006-maicon","nome":"Maicon","clube_id":8,"posicao_grupo":"Defensor","idade":38,"vinculo":"pendente_de_validacao"},{"id":"coritiba-007-rodrigo-moledo","nome":"Rodrigo Moledo","clube_id":8,"posicao_grupo":"Defensor","idade":39,"vinculo":"pendente_de_validacao"},{"id":"coritiba-008-felipe-jonatan","nome":"Felipe Jonatan","clube_id":8,"posicao_grupo":"Defensor","idade":28,"vinculo":"pendente_de_validacao"},{"id":"coritiba-009-fabricio-bustos","nome":"Fabricio Bustos","clube_id":8,"posicao_grupo":"Defensor","idade":30,"vinculo":"pendente_de_validacao"},{"id":"coritiba-010-thiago-santos","nome":"Thiago Santos","clube_id":8,"posicao_grupo":"Defensor","idade":37,"vinculo":"pendente_de_validacao","ovr_usuario":68},{"id":"coritiba-011-tiago-coser","nome":"Tiago Cóser","clube_id":8,"posicao_grupo":"Defensor","idade":22,"vinculo":"pendente_de_validacao","ovr_usuario":72},{"id":"coritiba-012-bruno-melo","nome":"Bruno Melo","clube_id":8,"posicao_grupo":"Defensor","idade":34,"vinculo":"pendente_de_validacao","ovr_usuario":69},{"id":"coritiba-013-jacy-maranhao","nome":"Jacy Maranhão","clube_id":8,"posicao_grupo":"Defensor","idade":29,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"coritiba-014-rodrigo-gelado","nome":"Rodrigo Gelado","clube_id":8,"posicao_grupo":"Defensor","idade":23,"vinculo":"pendente_de_validacao"},{"id":"coritiba-015-lucas-taverna","nome":"Lucas Taverna","clube_id":8,"posicao_grupo":"Defensor","idade":19,"vinculo":"pendente_de_validacao"},{"id":"coritiba-016-nicolas-fonseca","nome":"Nicolás Fonseca","clube_id":8,"posicao_grupo":"Meio-campista","idade":28,"vinculo":"pendente_de_validacao","ovr_usuario":70},{"id":"coritiba-017-josue","nome":"Josué","clube_id":8,"posicao_grupo":"Meio-campista","idade":36,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"coritiba-018-alejandro-ararat","nome":"Alejandro Ararat","clube_id":8,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"coritiba-019-sebastian-gomez","nome":"Sebastián Gómez","clube_id":8,"posicao_grupo":"Meio-campista","idade":30,"vinculo":"pendente_de_validacao","ovr_usuario":69},{"id":"coritiba-020-richard","nome":"Richard","clube_id":8,"posicao_grupo":"Meio-campista","idade":32,"vinculo":"pendente_de_validacao"},{"id":"coritiba-021-vini-paulista","nome":"Vini Paulista","clube_id":8,"posicao_grupo":"Meio-campista","idade":25,"vinculo":"pendente_de_validacao"},{"id":"coritiba-022-gustavo-silva","nome":"Gustavo Silva","clube_id":8,"posicao_grupo":"Meio-campista","idade":24,"vinculo":"pendente_de_validacao"},{"id":"coritiba-023-vitor-tissi","nome":"Vitor Tissi","clube_id":8,"posicao_grupo":"Meio-campista","idade":19,"vinculo":"pendente_de_validacao"},{"id":"coritiba-024-joaquin-lavega","nome":"Joaquín Lavega","clube_id":8,"posicao_grupo":"Atacante","idade":21,"vinculo":"pendente_de_validacao"},{"id":"coritiba-025-lucas-ronier","nome":"Lucas Ronier","clube_id":8,"posicao_grupo":"Atacante","idade":21,"vinculo":"pendente_de_validacao"},{"id":"coritiba-026-brian-ocampo","nome":"Brian Ocampo","clube_id":8,"posicao_grupo":"Atacante","idade":27,"vinculo":"pendente_de_validacao"},{"id":"coritiba-027-paulo-roberto","nome":"Paulo Roberto","clube_id":8,"posicao_grupo":"Atacante","idade":21,"vinculo":"pendente_de_validacao"},{"id":"coritiba-028-keno","nome":"Keno","clube_id":8,"posicao_grupo":"Atacante","idade":37,"vinculo":"pendente_de_validacao"},{"id":"coritiba-029-fabinho","nome":"Fabinho","clube_id":8,"posicao_grupo":"Atacante","idade":27,"vinculo":"pendente_de_validacao"},{"id":"coritiba-030-pedro-rocha","nome":"Pedro Rocha","clube_id":8,"posicao_grupo":"Atacante","idade":32,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"coritiba-031-breno-lopes","nome":"Breno Lopes","clube_id":8,"posicao_grupo":"Atacante","idade":30,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"coritiba-032-renato-marques","nome":"Renato Marques","clube_id":8,"posicao_grupo":"Atacante","idade":22,"vinculo":"pendente_de_validacao"},{"id":"coritiba-033-rodrigo-rodrigues","nome":"Rodrigo Rodrigues","clube_id":8,"posicao_grupo":"Atacante","idade":30,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-001-cassio","nome":"Cássio","clube_id":9,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-002-leo-aragao","nome":"Léo Aragão","clube_id":9,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-003-otavio","nome":"Otávio","clube_id":9,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"cruzeiro-004-kaua-moraes","nome":"Kauã Moraes","clube_id":9,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-005-matias-vina","nome":"Matías Viña","clube_id":9,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-006-william","nome":"William","clube_id":9,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-007-fabricio-bruno","nome":"Fabrício Bruno","clube_id":9,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"cruzeiro-008-fagner","nome":"Fagner","clube_id":9,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-009-lucas-villalba","nome":"Lucas Villalba","clube_id":9,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"cruzeiro-010-gabriel-rojas","nome":"Gabriel Rojas","clube_id":9,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"cruzeiro-011-jonathan-jesus","nome":"Jonathan Jesus","clube_id":9,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-012-joao-marcelo","nome":"João Marcelo","clube_id":9,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-013-ze-lucas","nome":"Zé Lucas","clube_id":9,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"cruzeiro-014-matheus-henrique","nome":"Matheus Henrique","clube_id":9,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-015-gerson","nome":"Gerson","clube_id":9,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":82},{"id":"cruzeiro-016-matheus-pereira","nome":"Matheus Pereira","clube_id":9,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":83},{"id":"cruzeiro-017-lucas-silva","nome":"Lucas Silva","clube_id":9,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-018-lucas-romero","nome":"Lucas Romero","clube_id":9,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"cruzeiro-019-felipe-morais","nome":"Felipe Morais","clube_id":9,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-020-fabrizio-peralta","nome":"Fabrizio Peralta","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-021-bruno-rodrigues","nome":"Bruno Rodrigues","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-022-marquinhos","nome":"Marquinhos","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":71},{"id":"cruzeiro-023-luis-sinisterra","nome":"Luis Sinisterra","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-024-kaio-jorge","nome":"Kaio Jorge","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":83},{"id":"cruzeiro-025-wesley","nome":"Wesley","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-026-neyser-villarreal","nome":"Neyser Villarreal","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-027-joao-costa","nome":"João Costa","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-028-kaique-kenji","nome":"Kaique Kenji","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-029-gabriel-pec","nome":"Gabriel Pec","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-030-wanderson","nome":"Wanderson","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-031-luciano-rodriguez","nome":"Luciano Rodríguez","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"cruzeiro-032-keny-arroyo","nome":"Keny Arroyo","clube_id":9,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-001-agustin-rossi","nome":"Agustín Rossi","clube_id":10,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"flamengo-002-andrew","nome":"Andrew","clube_id":10,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-003-dyogo-alves","nome":"Dyogo Alves","clube_id":10,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-004-leo-ortiz","nome":"Léo Ortiz","clube_id":10,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"flamengo-005-leo-pereira","nome":"Léo Pereira","clube_id":10,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"flamengo-006-danilo","nome":"Danilo","clube_id":10,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-007-vitao","nome":"Vitão","clube_id":10,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-008-joao-victor","nome":"João Victor","clube_id":10,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-009-guillermo-varela","nome":"Guillermo Varela","clube_id":10,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"flamengo-010-ayrton-lucas","nome":"Ayrton Lucas","clube_id":10,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-011-emerson-royal","nome":"Emerson Royal","clube_id":10,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-012-alex-sandro","nome":"Alex Sandro","clube_id":10,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"flamengo-013-erick-pulgar","nome":"Erick Pulgar","clube_id":10,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"flamengo-014-saul-niguez","nome":"Saúl Ñíguez","clube_id":10,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-015-giorgian-de-arrascaeta","nome":"Giorgian de Arrascaeta","clube_id":10,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":85},{"id":"flamengo-016-jorge-carrascal","nome":"Jorge Carrascal","clube_id":10,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"flamengo-017-nicolas-de-la-cruz","nome":"Nicolás de la Cruz","clube_id":10,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-018-lucas-paqueta","nome":"Lucas Paquetá","clube_id":10,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-019-jorginho","nome":"Jorginho","clube_id":10,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":83},{"id":"flamengo-020-evertton-araujo","nome":"Evertton Araújo","clube_id":10,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-021-luiz-araujo","nome":"Luiz Araújo","clube_id":10,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-022-pedro","nome":"Pedro","clube_id":10,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":84},{"id":"flamengo-023-anthony-valencia","nome":"Anthony Valencia","clube_id":10,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-024-samuel-lino","nome":"Samuel Lino","clube_id":10,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"flamengo-025-gonzalo-plata","nome":"Gonzalo Plata","clube_id":10,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-026-bruno-henrique","nome":"Bruno Henrique","clube_id":10,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"flamengo-027-joaquin-freitas","nome":"Joaquín Freitas","clube_id":10,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-001-fabio","nome":"Fábio","clube_id":11,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"fluminense-002-marcelo-pitaluga","nome":"Marcelo Pitaluga","clube_id":11,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-003-vitor-eudes","nome":"Vitor Eudes","clube_id":11,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-004-samuel-xavier","nome":"Samuel Xavier","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-005-thiago-silva","nome":"Thiago Silva","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":82},{"id":"fluminense-006-ignacio","nome":"Ignácio","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"fluminense-007-rene","nome":"Renê","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":71},{"id":"fluminense-008-guilherme-arana","nome":"Guilherme Arana","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-009-igor-rabello","nome":"Igor Rabello","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-010-juan-pablo-freytes","nome":"Juan Pablo Freytes","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-011-guga","nome":"Guga","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"fluminense-012-julian-millan","nome":"Julián Millán","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-013-jemmes","nome":"Jemmes","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-014-julio-fidelis","nome":"Júlio Fidélis","clube_id":11,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-015-martinelli","nome":"Martinelli","clube_id":11,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-016-ganso","nome":"Ganso","clube_id":11,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-017-nonato","nome":"Nonato","clube_id":11,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"fluminense-018-alisson","nome":"Alisson","clube_id":11,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-019-lucho-acosta","nome":"Lucho Acosta","clube_id":11,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"fluminense-020-hercules","nome":"Hércules","clube_id":11,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"fluminense-021-otavio","nome":"Otávio","clube_id":11,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-022-jefferson-savarino","nome":"Jefferson Savarino","clube_id":11,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-023-hulk","nome":"Hulk","clube_id":11,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"fluminense-024-john-kennedy","nome":"John Kennedy","clube_id":11,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"fluminense-025-german-cano","nome":"Germán Cano","clube_id":11,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-026-agustin-canobbio","nome":"Agustín Canobbio","clube_id":11,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"fluminense-027-rodrigo-castillo","nome":"Rodrigo Castillo","clube_id":11,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-028-riquelme","nome":"Riquelme","clube_id":11,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"fluminense-029-yeferson-soteldo","nome":"Yeferson Soteldo","clube_id":11,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"fluminense-030-kevin-serna","nome":"Kevin Serna","clube_id":11,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"gremio-001-thiago-beltrame","nome":"Thiago Beltrame","clube_id":12,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-002-weverton","nome":"Weverton","clube_id":12,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":83},{"id":"gremio-003-gabriel-grando","nome":"Gabriel Grando","clube_id":12,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-004-gabriel-menegon","nome":"Gabriel Menegon","clube_id":12,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-005-marlon","nome":"Marlon","clube_id":12,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"gremio-006-pedro-gabriel","nome":"Pedro Gabriel","clube_id":12,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-007-caio-paulista","nome":"Caio Paulista","clube_id":12,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-008-joao-pedro","nome":"João Pedro","clube_id":12,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"gremio-009-marcos-rocha","nome":"Marcos Rocha","clube_id":12,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-010-wagner-leonardo","nome":"Wagner Leonardo","clube_id":12,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-011-wallace","nome":"Wallace","clube_id":12,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"gremio-012-fabian-balbuena","nome":"Fabián Balbuena","clube_id":12,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"gremio-013-gustavo-martins","nome":"Gustavo Martins","clube_id":12,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"gremio-014-kannemann","nome":"Kannemann","clube_id":12,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-015-luis-eduardo","nome":"Luis Eduardo","clube_id":12,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-016-viery","nome":"Viery","clube_id":12,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-017-villasanti","nome":"Villasanti","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-018-willian","nome":"Willian","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-019-dodi","nome":"Dodi","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"gremio-020-erick-noriega","nome":"Erick Noriega","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"gremio-021-juan-nardoni","nome":"Juan Nardoni","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-022-leonel-perez","nome":"Leonel Pérez","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-023-monsalve","nome":"Monsalve","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-024-riquelme","nome":"Riquelme","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-025-roger","nome":"Roger","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-026-tiago","nome":"Tiago","clube_id":12,"posicao_grupo":"Meio-campo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-027-pavon","nome":"Pavón","clube_id":12,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-028-tete","nome":"Tetê","clube_id":12,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-029-amuzu","nome":"Amuzu","clube_id":12,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"gremio-030-braithwaite","nome":"Braithwaite","clube_id":12,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-031-carlos-vinicius","nome":"Carlos Vinícius","clube_id":12,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"gremio-032-enamorado","nome":"Enamorado","clube_id":12,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"gremio-033-gabriel-mec","nome":"Gabriel Mec","clube_id":12,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-001-sergio-rochet","nome":"Sergio Rochet","clube_id":13,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"internacional-002-anthoni","nome":"Anthoni","clube_id":13,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-003-kauan-jesus","nome":"Kauan Jesus","clube_id":13,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-004-matheus-cunha","nome":"Matheus Cunha","clube_id":13,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-005-diego-esser","nome":"Diego Esser","clube_id":13,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-006-felix-torres","nome":"Félix Torres","clube_id":13,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-007-gabriel-mercado","nome":"Gabriel Mercado","clube_id":13,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"internacional-008-guillermo-maripan","nome":"Guillermo Maripán","clube_id":13,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"internacional-009-juninho","nome":"Juninho","clube_id":13,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"internacional-010-victor-gabriel","nome":"Victor Gabriel","clube_id":13,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-011-bernabei","nome":"Bernabei","clube_id":13,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"internacional-012-braian-aguirre","nome":"Braian Aguirre","clube_id":13,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":72},{"id":"internacional-013-bruno-gomes","nome":"Bruno Gomes","clube_id":13,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"internacional-014-matheus-bahia","nome":"Matheus Bahia","clube_id":13,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"internacional-015-alan-patrick","nome":"Alan Patrick","clube_id":13,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"internacional-016-bruno-henrique","nome":"Bruno Henrique","clube_id":13,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-017-calebe","nome":"Calebe","clube_id":13,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-018-niclas-eliasson","nome":"Niclas Eliasson","clube_id":13,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-019-paulinho","nome":"Paulinho","clube_id":13,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-020-ronaldo","nome":"Ronaldo","clube_id":13,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-021-thiago-maia","nome":"Thiago Maia","clube_id":13,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"internacional-022-rodrigo-villagra","nome":"Rodrigo Villagra","clube_id":13,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"internacional-023-alerrandro","nome":"Alerrandro","clube_id":13,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":71},{"id":"internacional-024-johan-carbonero","nome":"Johan Carbonero","clube_id":13,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"internacional-025-kayky","nome":"Kayky","clube_id":13,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-026-antonio-sanabria","nome":"Antonio Sanabria","clube_id":13,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"internacional-027-vitinho","nome":"Vitinho","clube_id":13,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"mirassol-001-georgemy","nome":"Georgemy","clube_id":14,"posicao_grupo":"Goleiro","idade":30,"vinculo":"pendente_de_validacao"},{"id":"mirassol-002-walter","nome":"Walter","clube_id":14,"posicao_grupo":"Goleiro","idade":38,"vinculo":"pendente_de_validacao"},{"id":"mirassol-003-alex-muralha","nome":"Alex Muralha","clube_id":14,"posicao_grupo":"Goleiro","idade":36,"vinculo":"pendente_de_validacao"},{"id":"mirassol-004-thomazella","nome":"Thomazella","clube_id":14,"posicao_grupo":"Goleiro","idade":35,"vinculo":"pendente_de_validacao"},{"id":"mirassol-005-lucas-oliveira","nome":"Lucas Oliveira","clube_id":14,"posicao_grupo":"Defensor","idade":29,"vinculo":"pendente_de_validacao"},{"id":"mirassol-006-willian-machado","nome":"Willian Machado","clube_id":14,"posicao_grupo":"Defensor","idade":29,"vinculo":"pendente_de_validacao"},{"id":"mirassol-007-reinaldo","nome":"Reinaldo","clube_id":14,"posicao_grupo":"Defensor","idade":36,"vinculo":"pendente_de_validacao"},{"id":"mirassol-008-victor-luis","nome":"Victor Luis","clube_id":14,"posicao_grupo":"Defensor","idade":32,"vinculo":"pendente_de_validacao"},{"id":"mirassol-009-elias","nome":"Elias","clube_id":14,"posicao_grupo":"Defensor","idade":26,"vinculo":"pendente_de_validacao"},{"id":"mirassol-010-daniel-borges","nome":"Daniel Borges","clube_id":14,"posicao_grupo":"Defensor","idade":32,"vinculo":"pendente_de_validacao"},{"id":"mirassol-011-igor-formiga","nome":"Igor Formiga","clube_id":14,"posicao_grupo":"Defensor","idade":27,"vinculo":"pendente_de_validacao"},{"id":"mirassol-012-joao-victor","nome":"João Victor","clube_id":14,"posicao_grupo":"Defensor","idade":28,"vinculo":"pendente_de_validacao"},{"id":"mirassol-013-gabriel-knesowitsch","nome":"Gabriel Knesowitsch","clube_id":14,"posicao_grupo":"Defensor","idade":22,"vinculo":"pendente_de_validacao"},{"id":"mirassol-014-marcelinho","nome":"Marcelinho","clube_id":14,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"mirassol-015-japa","nome":"Japa","clube_id":14,"posicao_grupo":"Meio-campista","idade":21,"vinculo":"pendente_de_validacao"},{"id":"mirassol-016-shaylon","nome":"Shaylon","clube_id":14,"posicao_grupo":"Meio-campista","idade":28,"vinculo":"pendente_de_validacao"},{"id":"mirassol-017-denilson","nome":"Denilson","clube_id":14,"posicao_grupo":"Meio-campista","idade":24,"vinculo":"pendente_de_validacao"},{"id":"mirassol-018-chico-kim","nome":"Chico Kim","clube_id":14,"posicao_grupo":"Meio-campista","idade":34,"vinculo":"pendente_de_validacao"},{"id":"mirassol-019-jose-aldo","nome":"José Aldo","clube_id":14,"posicao_grupo":"Meio-campista","idade":27,"vinculo":"pendente_de_validacao"},{"id":"mirassol-020-neto-moura","nome":"Neto Moura","clube_id":14,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"mirassol-021-eduardo","nome":"Eduardo","clube_id":14,"posicao_grupo":"Meio-campista","idade":36,"vinculo":"pendente_de_validacao"},{"id":"mirassol-022-gustavo-cazonatti","nome":"Gustavo Cazonatti","clube_id":14,"posicao_grupo":"Meio-campista","idade":29,"vinculo":"pendente_de_validacao"},{"id":"mirassol-023-wallisson","nome":"Wallisson","clube_id":14,"posicao_grupo":"Meio-campista","idade":28,"vinculo":"pendente_de_validacao"},{"id":"mirassol-024-ze-roberto","nome":"Zé Roberto","clube_id":14,"posicao_grupo":"Atacante","idade":32,"vinculo":"pendente_de_validacao"},{"id":"mirassol-025-negueba","nome":"Negueba","clube_id":14,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"mirassol-026-gustavo-silva","nome":"Gustavo Silva","clube_id":14,"posicao_grupo":"Atacante","idade":28,"vinculo":"pendente_de_validacao"},{"id":"mirassol-027-fernandinho","nome":"Fernandinho","clube_id":14,"posicao_grupo":"Atacante","idade":28,"vinculo":"pendente_de_validacao"},{"id":"mirassol-028-bruno-santos","nome":"Bruno Santos","clube_id":14,"posicao_grupo":"Atacante","idade":29,"vinculo":"pendente_de_validacao"},{"id":"mirassol-029-alesson","nome":"Alesson","clube_id":14,"posicao_grupo":"Atacante","idade":26,"vinculo":"pendente_de_validacao"},{"id":"mirassol-030-edson-carioca","nome":"Edson Carioca","clube_id":14,"posicao_grupo":"Atacante","idade":28,"vinculo":"pendente_de_validacao"},{"id":"mirassol-031-carlos-eduardo","nome":"Carlos Eduardo","clube_id":14,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"mirassol-032-andre-luis","nome":"André Luis","clube_id":14,"posicao_grupo":"Atacante","idade":32,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-001-bruno-bertinato","nome":"Bruno Bertinato","clube_id":15,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-002-carlos-miguel","nome":"Carlos Miguel","clube_id":15,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"palmeiras-003-marcelo-lomba","nome":"Marcelo Lomba","clube_id":15,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-004-alexander-barboza","nome":"Alexander Barboza","clube_id":15,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"palmeiras-005-benedetti","nome":"Benedetti","clube_id":15,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"palmeiras-006-bruno-fuchs","nome":"Bruno Fuchs","clube_id":15,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"palmeiras-007-gustavo-gomez","nome":"Gustavo Gómez","clube_id":15,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-008-murilo","nome":"Murilo","clube_id":15,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-009-agustin-giay","nome":"Agustín Giay","clube_id":15,"posicao_grupo":"Lateral-direito","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-010-khellven","nome":"Khellven","clube_id":15,"posicao_grupo":"Lateral-direito","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"palmeiras-011-arthur","nome":"Arthur","clube_id":15,"posicao_grupo":"Lateral-esquerdo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-012-jefte","nome":"Jefté","clube_id":15,"posicao_grupo":"Lateral-esquerdo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-013-joaquin-piquerez","nome":"Joaquín Piquerez","clube_id":15,"posicao_grupo":"Lateral-esquerdo","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-014-andreas-pereira","nome":"Andreas Pereira","clube_id":15,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"palmeiras-015-emiliano-martinez","nome":"Emiliano Martínez","clube_id":15,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-016-felipe-anderson","nome":"Felipe Anderson","clube_id":15,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-017-larson","nome":"Larson","clube_id":15,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-018-lucas-evangelista","nome":"Lucas Evangelista","clube_id":15,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"palmeiras-019-marlon-freitas","nome":"Marlon Freitas","clube_id":15,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"palmeiras-020-mauricio","nome":"Mauricio","clube_id":15,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-021-jhon-arias","nome":"Jhon Arias","clube_id":15,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":82},{"id":"palmeiras-022-lopez","nome":"López","clube_id":15,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-023-paulinho","nome":"Paulinho","clube_id":15,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"palmeiras-024-ramon-sosa","nome":"Ramón Sosa","clube_id":15,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"palmeiras-025-vitor-roque","nome":"Vitor Roque","clube_id":15,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"remo-001-alexandre","nome":"Alexandre","clube_id":16,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-002-ivan","nome":"Ivan","clube_id":16,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-003-joao-victor","nome":"João Victor","clube_id":16,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-004-marcelo-rangel","nome":"Marcelo Rangel","clube_id":16,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-005-ygor-vinhas","nome":"Ygor Vinhas","clube_id":16,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-006-duplexe-tchamba","nome":"Duplexe Tchamba","clube_id":16,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-007-leo-andrade","nome":"Léo Andrade","clube_id":16,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-008-marllon","nome":"Marllon","clube_id":16,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-009-matheus-felipe","nome":"Matheus Felipe","clube_id":16,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-010-ze-ivaldo","nome":"Zé Ivaldo","clube_id":16,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-011-joao-lucas","nome":"João Lucas","clube_id":16,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-012-marcelinho","nome":"Marcelinho","clube_id":16,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-013-marlon","nome":"Marlon","clube_id":16,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-014-matheus-alexandre","nome":"Matheus Alexandre","clube_id":16,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-015-mayk","nome":"Mayk","clube_id":16,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-016-edson","nome":"Edson","clube_id":16,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-017-jaderson","nome":"Jaderson","clube_id":16,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-018-leonel-picco","nome":"Leonel Picco","clube_id":16,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-019-ze-ricardo","nome":"Zé Ricardo","clube_id":16,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-020-ze-welison","nome":"Zé Welison","clube_id":16,"posicao_grupo":"Volante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-021-david-braga","nome":"David Braga","clube_id":16,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-022-patrick","nome":"Patrick","clube_id":16,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-023-vitor-bueno","nome":"Vitor Bueno","clube_id":16,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-024-eduardo-melo","nome":"Eduardo Melo","clube_id":16,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-025-galeano","nome":"Galeano","clube_id":16,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-026-jaja","nome":"Jajá","clube_id":16,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-027-poveda","nome":"Poveda","clube_id":16,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-028-taliari","nome":"Taliari","clube_id":16,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-029-tico","nome":"Tico","clube_id":16,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"remo-030-yago-pikachu","nome":"Yago Pikachu","clube_id":16,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-001-gabriel-brazao","nome":"Gabriel Brazão","clube_id":17,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"santos-002-joao-paulo","nome":"João Paulo","clube_id":17,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-003-diogenes","nome":"Diógenes","clube_id":17,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-004-rodrigo-falcao","nome":"Rodrigo Falcão","clube_id":17,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-005-joao-pedro","nome":"João Pedro","clube_id":17,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-006-rodinei","nome":"Rodinei","clube_id":17,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"santos-007-igor-vinicius","nome":"Igor Vinícius","clube_id":17,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-008-lucas-verissimo","nome":"Lucas Veríssimo","clube_id":17,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-009-gonzalo-escobar","nome":"Gonzalo Escobar","clube_id":17,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-010-luan-peres","nome":"Luan Peres","clube_id":17,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":71},{"id":"santos-011-vinicius-lira","nome":"Vinicius Lira","clube_id":17,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-012-rafael-gonzaga","nome":"Rafael Gonzaga","clube_id":17,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-013-joao-ananias","nome":"João Ananias","clube_id":17,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-014-joao-alencar","nome":"João Alencar","clube_id":17,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":72},{"id":"santos-015-philippe-coutinho","nome":"Philippe Coutinho","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":82},{"id":"santos-016-arthur-melo","nome":"Arthur Melo","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"santos-017-miguelito","nome":"Miguelito","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-018-gabriel-bontempo","nome":"Gabriel Bontempo","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-019-benjamin-rollheiser","nome":"Benjamín Rollheiser","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-020-gabriel-menino","nome":"Gabriel Menino","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-021-willian-arao","nome":"Willian Arão","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"santos-022-thaciano","nome":"Thaciano","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-023-lima","nome":"Lima","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-024-joao-schmidt","nome":"João Schmidt","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-025-christian-oliva","nome":"Christian Oliva","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-026-gustavo-henrique","nome":"Gustavo Henrique","clube_id":17,"posicao_grupo":"Meia","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-027-neymar","nome":"Neymar","clube_id":17,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":86},{"id":"santos-028-gabriel-barbosa","nome":"Gabriel Barbosa","clube_id":17,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"santos-029-rony","nome":"Rony","clube_id":17,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-030-moises","nome":"Moisés","clube_id":17,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-031-nadson","nome":"Nadson","clube_id":17,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-032-mateus-xavier","nome":"Mateus Xavier","clube_id":17,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-033-gustavo-caballero","nome":"Gustavo Caballero","clube_id":17,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"santos-034-everton-cebolinha","nome":"Everton Cebolinha","clube_id":17,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"santos-035-alvaro-barreal","nome":"Álvaro Barreal","clube_id":17,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-001-rafael","nome":"Rafael","clube_id":18,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"sao-paulo-002-coronel","nome":"Coronel","clube_id":18,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-003-joao-pedro-pantiga","nome":"João Pedro Pantiga","clube_id":18,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-004-young","nome":"Young","clube_id":18,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-005-rafael-toloi","nome":"Rafael Toloi","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"sao-paulo-006-arboleda","nome":"Arboleda","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"sao-paulo-007-iago","nome":"Iago","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-008-enzo-diaz","nome":"Enzo Díaz","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-009-wendell","nome":"Wendell","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-010-lucas-ramon","nome":"Lucas Ramon","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-011-buta","nome":"Buta","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-012-cedric","nome":"Cédric","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-013-domingos-duarte","nome":"Domingos Duarte","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-014-pedro-lima","nome":"Pedro Lima","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"sao-paulo-015-sabino","nome":"Sabino","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-016-isac","nome":"Isac","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-017-osorio","nome":"Osorio","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-018-nicolas","nome":"Nicolas","clube_id":18,"posicao_grupo":"Defensor","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-019-marcos-antonio","nome":"Marcos Antônio","clube_id":18,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"sao-paulo-020-bobadilla","nome":"Bobadilla","clube_id":18,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-021-newton-jr","nome":"Newton Jr.","clube_id":18,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-022-pablo-maia","nome":"Pablo Maia","clube_id":18,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"sao-paulo-023-pedro-ferreira","nome":"Pedro Ferreira","clube_id":18,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-024-djhordney","nome":"Djhordney","clube_id":18,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":74},{"id":"sao-paulo-025-cauly","nome":"Cauly","clube_id":18,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-026-danielzinho","nome":"Danielzinho","clube_id":18,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-027-felipe-preis","nome":"Felipe Preis","clube_id":18,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-028-lucas-moura","nome":"Lucas Moura","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":81},{"id":"sao-paulo-029-calleri","nome":"Calleri","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"sao-paulo-030-luciano","nome":"Luciano","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"sao-paulo-031-ferreira","nome":"Ferreira","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-032-andre-silva","nome":"André Silva","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-033-victor-sa","nome":"Victor Sá","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-034-tete","nome":"Tete","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-035-artur","nome":"Artur","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-036-gustavo-santana","nome":"Gustavo Santana","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-037-lucca","nome":"Lucca","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"sao-paulo-038-ryan-francisco","nome":"Ryan Francisco","clube_id":18,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vasco-001-leo-jardim","nome":"Léo Jardim","clube_id":19,"posicao_grupo":"Goleiro","idade":31,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"vasco-002-daniel-fuzato","nome":"Daniel Fuzato","clube_id":19,"posicao_grupo":"Goleiro","idade":29,"vinculo":"pendente_de_validacao"},{"id":"vasco-003-pablo","nome":"Pablo","clube_id":19,"posicao_grupo":"Goleiro","idade":23,"vinculo":"pendente_de_validacao"},{"id":"vasco-004-jose-luis-rodriguez","nome":"José Luis Rodríguez","clube_id":19,"posicao_grupo":"Defensor","idade":29,"vinculo":"pendente_de_validacao"},{"id":"vasco-005-alan-saldivia","nome":"Alan Saldivia","clube_id":19,"posicao_grupo":"Defensor","idade":24,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"vasco-006-lucas-piton","nome":"Lucas Piton","clube_id":19,"posicao_grupo":"Defensor","idade":26,"vinculo":"pendente_de_validacao"},{"id":"vasco-007-paulinho","nome":"Paulinho","clube_id":19,"posicao_grupo":"Defensor","idade":22,"vinculo":"pendente_de_validacao"},{"id":"vasco-008-robert-renan","nome":"Robert Renan","clube_id":19,"posicao_grupo":"Defensor","idade":23,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"vasco-009-lucas-freitas","nome":"Lucas Freitas","clube_id":19,"posicao_grupo":"Defensor","idade":25,"vinculo":"pendente_de_validacao"},{"id":"vasco-010-carlos-cuesta","nome":"Carlos Cuesta","clube_id":19,"posicao_grupo":"Defensor","idade":27,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"vasco-011-gabriel-pereira","nome":"Gabriel Pereira","clube_id":19,"posicao_grupo":"Defensor","idade":26,"vinculo":"pendente_de_validacao"},{"id":"vasco-012-jv-fonseca","nome":"JV Fonseca","clube_id":19,"posicao_grupo":"Defensor","idade":21,"vinculo":"pendente_de_validacao"},{"id":"vasco-013-walace-falcao","nome":"Walace Falcão","clube_id":19,"posicao_grupo":"Defensor","idade":21,"vinculo":"pendente_de_validacao"},{"id":"vasco-014-cuiabano","nome":"Cuiabano","clube_id":19,"posicao_grupo":"Defensor","idade":23,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"vasco-015-paulo-henrique","nome":"Paulo Henrique","clube_id":19,"posicao_grupo":"Defensor","idade":30,"vinculo":"pendente_de_validacao"},{"id":"vasco-016-riquelme","nome":"Riquelme","clube_id":19,"posicao_grupo":"Defensor","idade":24,"vinculo":"pendente_de_validacao"},{"id":"vasco-017-tche-tche","nome":"Tchê Tchê","clube_id":19,"posicao_grupo":"Meio-campista","idade":34,"vinculo":"pendente_de_validacao"},{"id":"vasco-018-santiago-sosa","nome":"Santiago Sosa","clube_id":19,"posicao_grupo":"Meio-campista","idade":27,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"vasco-019-jair","nome":"Jair","clube_id":19,"posicao_grupo":"Meio-campista","idade":32,"vinculo":"pendente_de_validacao"},{"id":"vasco-020-johan-rojas","nome":"Johan Rojas","clube_id":19,"posicao_grupo":"Meio-campista","idade":24,"vinculo":"pendente_de_validacao"},{"id":"vasco-021-guilherme-estrella","nome":"Guilherme Estrella","clube_id":19,"posicao_grupo":"Meio-campista","idade":21,"vinculo":"pendente_de_validacao"},{"id":"vasco-022-alan-lescano","nome":"Alan Lescano","clube_id":19,"posicao_grupo":"Meio-campista","idade":25,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"vasco-023-thiago-mendes","nome":"Thiago Mendes","clube_id":19,"posicao_grupo":"Meio-campista","idade":34,"vinculo":"pendente_de_validacao","ovr_usuario":78},{"id":"vasco-024-euder","nome":"Euder","clube_id":19,"posicao_grupo":"Meio-campista","idade":21,"vinculo":"pendente_de_validacao"},{"id":"vasco-025-ramon-rique","nome":"Ramon Rique","clube_id":19,"posicao_grupo":"Meio-campista","idade":19,"vinculo":"pendente_de_validacao"},{"id":"vasco-026-mateus-carvalho","nome":"Mateus Carvalho","clube_id":19,"posicao_grupo":"Meio-campista","idade":24,"vinculo":"pendente_de_validacao"},{"id":"vasco-027-cauan-barros","nome":"Cauan Barros","clube_id":19,"posicao_grupo":"Meio-campista","idade":22,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"vasco-028-david","nome":"David","clube_id":19,"posicao_grupo":"Atacante","idade":31,"vinculo":"pendente_de_validacao"},{"id":"vasco-029-facundo-colidio","nome":"Facundo Colidio","clube_id":19,"posicao_grupo":"Atacante","idade":26,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"vasco-030-andres-gomez","nome":"Andrés Gómez","clube_id":19,"posicao_grupo":"Atacante","idade":24,"vinculo":"pendente_de_validacao","ovr_usuario":79},{"id":"vasco-031-nuno-moreira","nome":"Nuno Moreira","clube_id":19,"posicao_grupo":"Atacante","idade":27,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"vasco-032-marino-hinestroza","nome":"Marino Hinestroza","clube_id":19,"posicao_grupo":"Atacante","idade":24,"vinculo":"pendente_de_validacao"},{"id":"vasco-033-bruno-duarte","nome":"Bruno Duarte","clube_id":19,"posicao_grupo":"Atacante","idade":30,"vinculo":"pendente_de_validacao","ovr_usuario":72},{"id":"vasco-034-brenner","nome":"Brenner","clube_id":19,"posicao_grupo":"Atacante","idade":26,"vinculo":"pendente_de_validacao"},{"id":"vasco-035-adson","nome":"Adson","clube_id":19,"posicao_grupo":"Atacante","idade":26,"vinculo":"pendente_de_validacao"},{"id":"vasco-036-loide-augusto","nome":"Loide Augusto","clube_id":19,"posicao_grupo":"Atacante","idade":26,"vinculo":"pendente_de_validacao"},{"id":"vasco-037-claudio-spinelli","nome":"Claudio Spinelli","clube_id":19,"posicao_grupo":"Atacante","idade":29,"vinculo":"pendente_de_validacao"},{"id":"vitoria-001-lucas-arcanjo","nome":"Lucas Arcanjo","clube_id":20,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":80},{"id":"vitoria-002-yuri-sena","nome":"Yuri Sena","clube_id":20,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-003-fintelman","nome":"Fintelman","clube_id":20,"posicao_grupo":"Goleiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-004-caca","nome":"Cacá","clube_id":20,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"vitoria-005-emmanuel-britez","nome":"Emmanuel Brítez","clube_id":20,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":72},{"id":"vitoria-006-camutanga","nome":"Camutanga","clube_id":20,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-007-riccieli","nome":"Riccieli","clube_id":20,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-008-darlan","nome":"Darlan","clube_id":20,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-009-luan-candido","nome":"Luan Cândido","clube_id":20,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-010-edenilson-nascimento","nome":"Edenilson Nascimento","clube_id":20,"posicao_grupo":"Zagueiro","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-011-ramon","nome":"Ramon","clube_id":20,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-012-nathan-mendes","nome":"Nathan Mendes","clube_id":20,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-013-jamerson","nome":"Jamerson","clube_id":20,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":69},{"id":"vitoria-014-gean","nome":"Gean","clube_id":20,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-015-mateus-silva","nome":"Mateus Silva","clube_id":20,"posicao_grupo":"Lateral","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-016-gabriel-baralhas","nome":"Gabriel Baralhas","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":73},{"id":"vitoria-017-caique-goncalves","nome":"Caíque Gonçalves","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":75},{"id":"vitoria-018-emmanuel-martinez","nome":"Emmanuel Martínez","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":72},{"id":"vitoria-019-matheuzinho","nome":"Matheuzinho","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":77},{"id":"vitoria-020-walace","nome":"Walace","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-021-ruben-ismael","nome":"Rúben Ismael","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-022-ze-vitor","nome":"Zé Vitor","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-023-pochettino","nome":"Pochettino","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-024-alejandro-almaraz","nome":"Alejandro Almaraz","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-025-dudu","nome":"Dudu","clube_id":20,"posicao_grupo":"Meio-campista","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-026-renato-kayzer","nome":"Renato Kayzer","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-027-marinho","nome":"Marinho","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-028-erick","nome":"Erick","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"vitoria-029-nacho-laquintana","nome":"Nacho Laquintana","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-030-rene","nome":"Renê","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao","ovr_usuario":76},{"id":"vitoria-031-diego-tarzia","nome":"Diego Tarzia","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-032-alex-bruno","nome":"Alex Bruno","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-033-lucas-silva","nome":"Lucas Silva","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-034-fabri","nome":"Fabri","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"vitoria-035-osvaldo","nome":"Osvaldo","clube_id":20,"posicao_grupo":"Atacante","idade":null,"vinculo":"pendente_de_validacao"},{"id":"revisao-17-gustavinho","nome":"Gustavinho","clube_id":17,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":72},{"id":"revisao-9-william-furtado","nome":"William Furtado","clube_id":9,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":76},{"id":"revisao-15-flaco-lopez","nome":"Flaco Lopez","clube_id":15,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":83},{"id":"revisao-7-anglieri","nome":"Anglieri","clube_id":7,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":75},{"id":"revisao-4-tiquinho-soares","nome":"Tiquinho Soares","clube_id":4,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":74},{"id":"revisao-12-pavon","nome":"Pavon","clube_id":12,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":76},{"id":"revisao-3-denis-duarte","nome":"Denis Duarte","clube_id":3,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":76},{"id":"revisao-19-pedro-henrique","nome":"Pedro Henrique","clube_id":19,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":78},{"id":"revisao-20-matheusinho","nome":"Matheusinho","clube_id":20,"posicao_grupo":"MEIA","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":70},{"id":"revisao-5-thiago-volpi","nome":"Thiago Volpi","clube_id":5,"posicao_grupo":"GOLEIRO","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":78},{"id":"revisao-5-ryan-augusto","nome":"Ryan Augusto","clube_id":5,"posicao_grupo":"MEIA","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":76},{"id":"revisao-5-erick-ramires","nome":"Erick Ramires","clube_id":5,"posicao_grupo":"MEIA","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":77},{"id":"revisao-18-luis-osorio","nome":"Luis Osorio","clube_id":18,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":71},{"id":"revisao-18-iago-borduchi","nome":"Iago Borduchi","clube_id":18,"posicao_grupo":"DEFENSOR","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":73},{"id":"revisao-18-arthur","nome":"Arthur","clube_id":18,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":79},{"id":"revisao-18-ferreirinha","nome":"Ferreirinha","clube_id":18,"posicao_grupo":"ATACANTE","idade":null,"vinculo":"adicionado_por_lista_usuario_posicao_provisoria","ovr_usuario":75}];
async function loadRealRosters(){
  marketRosters={};
  embeddedRosters.forEach((p,i)=>{(marketRosters[p.clube_id]??=[]).push(gamePlayer(p,i));});
  realRostersLoaded=Object.keys(marketRosters).length===20 && embeddedRosters.length>=635;
  if(!realRostersLoaded)console.error('Banco de elencos incorporado incompleto');
}

// Números de referência para alguns atletas; demais são provisórios e únicos por elenco.
const knownShirts={
 'internacional':{'alan patrick':10,'rafael borre':19,'rochet':1,'vitinho':11},
 'santos':{'neymar':10},'atletico-mg':{'hulk':7},
 'flamengo':{'arrascaeta':10,'pedro':9},'corinthians':{'yuri alberto':9},
 'bahia':{'everton ribeiro':10},'cruzeiro':{'matheus pereira':10}
};
function assignShirtNumbers(players,clubId){
 const club=normalizedName((clubs.find(c=>c.id===clubId)||fallbackClubs.find(c=>c.id===clubId)||{}).name).replace(/\s+/g,'-');
 const aliases={'atletico-mineiro':'atletico-mg','internacional':'internacional'};
 const refs=knownShirts[aliases[club]||club]||{};
 const used=new Set();
 players.forEach(p=>{const n=refs[normalizedName(p.name)];if(n&&n<=99&&!used.has(n)){p.shirtNumber=n;used.add(n);}});
 players.forEach(p=>{if(p.shirtNumber)return;let n=p.pos==='GOL'?[1,12,22,31,33].find(v=>!used.has(v)):undefined;if(!n){n=2;while(used.has(n)&&n<=99)n++;}if(n>99)throw Error('Sem números disponíveis');p.shirtNumber=n;used.add(n);});
 return players;
}
function ensureSetPieces(){
 const starters=squad.filter(p=>p.starter);
 const choose=(key,score)=>{if(!squad.some(p=>p.id===setPieceTakers[key])){setPieceTakers[key]=[...starters].sort((a,b)=>score(b)-score(a))[0]?.id||null;}};
 choose('captain',p=>p.ovr);choose('penalty',p=>(p.attributes?.finalizacao||0)+(p.attributes?.frieza||0));
 choose('freeKick',p=>(p.attributes?.bola_parada||0)+(p.attributes?.passe||0));
 choose('corner',p=>(p.attributes?.cruzamento||0)+(p.attributes?.passe||0));
}
const setPieceTakers={captain:null,penalty:null,freeKick:null,corner:null};
function showShirtEditor(){
 openModal(`<h2>Numeração do elenco</h2><p class="modal-sub">Altere as camisas de 1 a 99. Números repetidos não são permitidos. Os números não confirmados são provisórios.</p><div class="shirt-editor">${squad.map(p=>`<label class="shirt-row"><span>${escapeHtml(p.name)}</span><input type="number" min="1" max="99" data-shirt="${p.id}" value="${p.shirtNumber}"></label>`).join('')}</div><div class="modal-actions"><button id="save-shirts" class="primary-button">SALVAR CAMISAS</button><button id="shirt-back" class="secondary-button">VOLTAR</button></div>`);
 $('#shirt-back').onclick=()=>openMenu('club');
 $('#save-shirts').onclick=()=>{const entries=[...document.querySelectorAll('[data-shirt]')].map(x=>({id:Number(x.dataset.shirt),n:Number(x.value)}));const nums=entries.map(x=>x.n);if(nums.some(n=>!Number.isInteger(n)||n<1||n>99)||new Set(nums).size!==nums.length){toast('Use números únicos entre 1 e 99.');return;}entries.forEach(({id,n})=>{squad.find(p=>p.id===id).shirtNumber=n;});renderSquad();openMenu('club');toast('Camisas atualizadas.');};
}
function showSetPieceEditor(){
 ensureSetPieces();const opts=squad.filter(p=>p.starter).map(p=>`<option value="${p.id}">#${p.shirtNumber} ${escapeHtml(p.name)}</option>`).join('');
 const roles=[['captain','Capitão'],['penalty','Cobrador de pênalti'],['freeKick','Cobrador de falta'],['corner','Cobrador de escanteio']];
 openModal(`<h2>Capitão e bolas paradas</h2><p class="modal-sub">Defina os responsáveis entre os titulares. Durante um pênalti, você poderá trocar o batedor.</p><div class="match-settings">${roles.map(([k,label])=>`<label>${label}<select data-role="${k}">${opts}</select></label>`).join('')}</div><div class="modal-actions"><button id="save-roles" class="primary-button">SALVAR</button><button id="roles-back" class="secondary-button">VOLTAR</button></div>`);
 document.querySelectorAll('[data-role]').forEach(x=>x.value=String(setPieceTakers[x.dataset.role]));
 $('#roles-back').onclick=()=>openMenu('club');
 $('#save-roles').onclick=()=>{document.querySelectorAll('[data-role]').forEach(x=>setPieceTakers[x.dataset.role]=Number(x.value));openMenu('club');toast('Responsáveis definidos.');};
}
// PARTE 13 — Campeonato fictício: classificação evolui após cada rodada concluída.
let leagueRecords=new Map(),leagueResults=[];
let leagueFixtures=[];
function initializeLeague(){
 leagueRecords=new Map();leagueResults=[];
 clubs.forEach((club,i)=>{const initialPoints=club.id===selectedClub.id?33:Math.max(18,68-i*2);const wins=Math.floor(initialPoints/3);const draws=initialPoints%3;
 leagueRecords.set(club.id,{club,played:32,wins,draws,losses:32-wins-draws,gf:Math.max(20,42-i),ga:Math.max(20,34+i),points:initialPoints});});
}
function applyLeagueResult(a,b,ga,gb,round){
 const home=leagueRecords.get(a.id),away=leagueRecords.get(b.id);if(!home||!away)return;
 home.played++;away.played++;home.gf+=ga;home.ga+=gb;away.gf+=gb;away.ga+=ga;
 if(ga>gb){home.wins++;away.losses++;home.points+=3;}else if(gb>ga){away.wins++;home.losses++;away.points+=3;}else{home.draws++;away.draws++;home.points++;away.points++;}
 leagueResults.push({round,home:a.name,away:b.name,score:`${ga} × ${gb}`});
}
function recordLeagueRound(m){
 if(!leagueRecords.size)initializeLeague();
 const round=calendar.findIndex(x=>x.day===day)+1;
 if(round<1||leagueResults.some(r=>r.round===round))return;
 const fixtures=leagueFixtures[round-1]||[];
 const opponent=clubs.find(c=>c.name===m.game.opponent);if(!opponent)return;
 for(const fixture of fixtures){
  const a=clubs.find(c=>c.id===fixture.home),b=clubs.find(c=>c.id===fixture.away);
  if(!a||!b)continue;
  if(a.id===selectedClub.id||b.id===selectedClub.id){
   const userHome=a.id===selectedClub.id;
   applyLeagueResult(a,b,userHome?m.home:m.away,userHome?m.away:m.home,round);
  }else{
   const strengthA=(marketRosters[a.id]||[]).slice(0,11).reduce((n,p)=>n+p.ovr,0)/11||70;
   const strengthB=(marketRosters[b.id]||[]).slice(0,11).reduce((n,p)=>n+p.ovr,0)/11||70;
   const ga=Math.max(0,Math.min(5,Math.floor(Math.random()*3+(strengthA-strengthB)/20+.45)));
   const gb=Math.max(0,Math.min(5,Math.floor(Math.random()*3+(strengthB-strengthA)/20)));
   applyLeagueResult(a,b,ga,gb,round);
  }
 }
 renderCampaignLeagueStatus();renderHomeStandings();
 messages.unshift({title:`Rodada ${round} encerrada`,text:`${selectedClub.name} ${m.home} × ${m.away} ${m.game.opponent}. Classificação e resultados atualizados.`});renderMessagesDot();
}
function renderCampaignLeagueStatus(){
 if(!selectedClub||!leagueRecords.size)return;
 const sorted=sortedLeague(),index=sorted.findIndex(r=>r.club.id===selectedClub.id),own=sorted[index];
 if(!own)return;
 const position=index+1,remaining=Math.max(0,calendar.length-completedMatchDays.size);
 const posEl=$('#league-position'),statusEl=$('#league-status');
 if(posEl)posEl.textContent=`${position}º`;
 if(statusEl)statusEl.textContent=position>=17?'Zona de rebaixamento':position<=4?'Zona de Libertadores':'Fora da zona de rebaixamento';
 const card=document.querySelector('.mission-card');
 if(card){
  const points=card.querySelector('.points-row strong'),games=card.querySelector('.points-row span'),note=card.querySelector('.muted'),bar=card.querySelector('.progress-track i');
  if(points)points.innerHTML=`${own.points} <small>PTS</small>`;
  if(games)games.textContent=`${remaining} ${remaining===1?'jogo restante':'jogos restantes'}`;
  if(note)note.textContent=position>=17?'Você precisa reagir nas próximas rodadas.':`Seu clube está em ${position}º lugar. Continue pontuando!`;
  if(bar)bar.style.width=`${Math.max(4,Math.min(100,(21-position)/20*100))}%`;
 }
}
function sortedLeague(){return [...leagueRecords.values()].sort((a,b)=>b.points-a.points||(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf);}
function fullStandings(){
 if(!leagueRecords.size)initializeLeague();
 return `<div class="league-table-head"><span>POS</span><span>CLUBE</span><span>PTS</span><span>PJ</span><span>V</span><span>E</span><span>D</span><span>SG</span></div>`+sortedLeague().map((r,i)=>`<div class="league-table-row ${i>=16?'standings-z4':''} ${r.club.id===selectedClub.id?'league-own':''}"><b>${i+1}º</b><span>${escapeHtml(r.club.name)}${r.club.id===selectedClub.id?' • VOCÊ':''}</span><strong>${r.points}</strong><span>${r.played}</span><span>${r.wins}</span><span>${r.draws}</span><span>${r.losses}</span><span>${r.gf-r.ga}</span></div>`).join('');
}
function upcomingRoundSummary(){
 const next=calendar.find(x=>!completedMatchDays.has(x.day)&&x.day>=day);
 if(!next)return '<p class="modal-sub">Não há mais confrontos pendentes nesta campanha.</p>';
 const games=leagueFixtures[next.round-1]||[];
 return `<h3>PRÓXIMA RODADA ${next.round} · DIA ${next.day}</h3><div class="league-results">${games.map(f=>{const a=clubs.find(c=>c.id===f.home),b=clubs.find(c=>c.id===f.away);return `<div><span>${escapeHtml(a?.name||'')}</span><b>×</b><span>${escapeHtml(b?.name||'')}</span></div>`}).join('')}</div>`;
}
function leagueHistorySummary(){
 const rounds=[...new Set(leagueResults.map(r=>r.round))].sort((a,b)=>b-a);
 if(!rounds.length)return '<p class="modal-sub">Nenhuma rodada disputada.</p>';
 return rounds.map(round=>`<h3>RESULTADOS DA RODADA ${round}</h3><div class="league-results">${leagueResults.filter(r=>r.round===round).map(r=>`<div><span>${escapeHtml(r.home)}</span><b>${r.score}</b><span>${escapeHtml(r.away)}</span></div>`).join('')}</div>`).join('');
}
function leagueRoundSummary(){
 const round=calendar.filter(x=>completedMatchDays.has(x.day)).length;
 if(!round)return '<p class="modal-sub">Nenhuma rodada da sua campanha foi disputada ainda.</p>';
 return `<h3>RESULTADOS DA RODADA ${round}</h3><div class="league-results">${leagueResults.filter(r=>r.round===round).map(r=>`<div><span>${escapeHtml(r.home)}</span><b>${r.score}</b><span>${escapeHtml(r.away)}</span></div>`).join('')}</div>`;
}

function initialSquad(clubId){
  const players=(marketRosters[clubId]||[]).map(p=>({...p}));
  if(!players.length)return [];
  const priority=['GOL','ZAG','ZAG','LAT','LAT','VOL','MC','MC','ATA','ATA','ATA'];
  const remaining=[...players],starting=[];
  for(const pos of priority){
    const ix=remaining.findIndex(p=>p.pos===pos);
    starting.push(remaining.splice(ix>=0?ix:0,1)[0]);
  }
  return assignShirtNumbers([...starting,...remaining].map((p,i)=>({...p,starter:i<11,slot:i})),clubId);
}


async function loadClubs(){
  try{
    const response = await fetch("clubes.json?v=2026-11-19");
    if(!response.ok) throw new Error("Falha ao carregar");
    clubs = await response.json();
  }catch(e){
    clubs = fallbackClubs;
  }
  renderClubs();
  renderHomeStandings();
}
const fallbackClubs = [
  {
    "id": 1,
    "name": "Athletico-PR",
    "symbol": "🔴⚫",
    "short": "Athletico-",
    "color": "#f7dddd"
  },
  {
    "id": 2,
    "name": "Atlético-MG",
    "symbol": "⚫⚪",
    "short": "Atlético-M",
    "color": "#e7e7e7"
  },
  {
    "id": 3,
    "name": "Bahia",
    "symbol": "🔵🔴",
    "short": "Bahia",
    "color": "#e2eafa"
  },
  {
    "id": 4,
    "name": "Botafogo",
    "symbol": "⭐",
    "short": "Botafogo",
    "color": "#eeeeee"
  },
  {
    "id": 5,
    "name": "Bragantino",
    "symbol": "⚪🔴",
    "short": "Bragantino",
    "color": "#f7e4e4"
  },
  {
    "id": 6,
    "name": "Chapecoense",
    "symbol": "🟢⚪",
    "short": "Chapecoens",
    "color": "#dcefdc"
  },
  {
    "id": 7,
    "name": "Corinthians",
    "symbol": "⚫⚪",
    "short": "Corinthian",
    "color": "#ededed"
  },
  {
    "id": 8,
    "name": "Coritiba",
    "symbol": "🟢⚪",
    "short": "Coritiba",
    "color": "#e0f2e2"
  },
  {
    "id": 9,
    "name": "Cruzeiro",
    "symbol": "🔵⚪",
    "short": "Cruzeiro",
    "color": "#e0eaff"
  },
  {
    "id": 10,
    "name": "Flamengo",
    "symbol": "🔴⚫",
    "short": "Flamengo",
    "color": "#f7dede"
  },
  {
    "id": 11,
    "name": "Fluminense",
    "symbol": "🟢🔴",
    "short": "Fluminense",
    "color": "#e3f1e2"
  },
  {
    "id": 12,
    "name": "Grêmio",
    "symbol": "🔵⚫",
    "short": "Grêmio",
    "color": "#e0ebf5"
  },
  {
    "id": 13,
    "name": "Internacional",
    "symbol": "🔴",
    "short": "Internacio",
    "color": "#f8e0e0"
  },
  {
    "id": 14,
    "name": "Mirassol",
    "symbol": "🟢🟡",
    "short": "Mirassol",
    "color": "#e8f2d7"
  },
  {
    "id": 15,
    "name": "Palmeiras",
    "symbol": "🟢⚪",
    "short": "Palmeiras",
    "color": "#dff2df"
  },
  {
    "id": 16,
    "name": "Remo",
    "symbol": "🔵⚪",
    "short": "Remo",
    "color": "#e0eaff"
  },
  {
    "id": 17,
    "name": "Santos",
    "symbol": "⚪⚫",
    "short": "Santos",
    "color": "#eeeeee"
  },
  {
    "id": 18,
    "name": "São Paulo",
    "symbol": "🔴⚪",
    "short": "São Paulo",
    "color": "#f6e1e1"
  },
  {
    "id": 19,
    "name": "Vasco",
    "symbol": "⚫⚪",
    "short": "Vasco",
    "color": "#e9e9e9"
  },
  {
    "id": 20,
    "name": "Vitória",
    "symbol": "🔴⚫",
    "short": "Vitória",
    "color": "#f6e0e0"
  }
];

function showScreen(id){screens.forEach(s=>$("#"+s).classList.toggle("hidden",s!==id));}
function renderClubs(){
  $("#club-grid").innerHTML=clubs.map(c=>`<button class="club-card" data-id="${c.id}"><div class="club-crest" style="--crest:${c.color||'#dcefe0'}">${c.symbol||"⚽"}</div><strong>${c.name}</strong><small>Brasileirão • Série A</small></button>`).join("");
  $("#club-grid").querySelectorAll(".club-card").forEach(btn=>btn.addEventListener("click",()=>{
    selectedClub=clubs.find(c=>String(c.id)===btn.dataset.id);
    $("#club-grid").querySelectorAll(".club-card").forEach(b=>b.classList.toggle("selected",b===btn));
    $("#confirm-club").disabled=false;
  }));
}
function renderHomeStandings(){
 const table=$('#home-league-table');if(!table)return;
 if(!selectedClub||!leagueRecords.size){table.innerHTML='<p>Escolha seu clube para acompanhar a classificação.</p>';return;}
 table.innerHTML=`<div class="home-table-columns"><span>POS</span><span>CLUBE</span><span>PTS</span></div>`+sortedLeague().map((r,i)=>`<div class="home-table-row ${i>=16?'relegation':''} ${r.club.id===selectedClub.id?'my-placeholder':''}"><b>${i+1}º</b><span>${escapeHtml(r.club.name)}${r.club.id===selectedClub.id?' • VOCÊ':''}</span><strong>${r.points}</strong></div>`).join('');
}
function updateMorale(){
  $("#morale-value").textContent=`${morale}%`;
  $("#morale-fill").style.width=`${morale}%`;
  $("#morale-face").textContent=morale<20?"😡":morale<40?"😟":morale<65?"😐":morale<85?"🙂":"😄";
}
function openTutorial(step=0){tutorialStep=step;renderTutorial();}
function renderTutorial(){
  const [title,description]=tutorialTips[tutorialStep];
  openModal(`<div class="tutorial-top"><span>COMO JOGAR</span><small>DICA ${tutorialStep+1} DE ${tutorialTips.length}</small></div><h2>${title}</h2><p class="tutorial-description">${description}</p><div class="tutorial-progress">${tutorialTips.map((_,i)=>`<i class="${i<=tutorialStep?'active':''}"></i>`).join('')}</div><div class="tutorial-actions"><button class="secondary-button" id="skip-tutorial">PULAR TUTORIAL</button><div><button class="secondary-button" id="tutorial-back" ${tutorialStep===0?'disabled':''}>VOLTAR</button><button class="primary-button" id="tutorial-next">${tutorialStep===tutorialTips.length-1?'CONCLUIR':'PRÓXIMO →'}</button></div></div>`);
  $("#skip-tutorial").addEventListener('click',()=>{tutorialSeen=true;closeModal();});
  $("#tutorial-back").addEventListener('click',()=>openTutorial(Math.max(0,tutorialStep-1)));
  $("#tutorial-next").addEventListener('click',()=>{if(tutorialStep===tutorialTips.length-1){tutorialSeen=true;closeModal();}else openTutorial(tutorialStep+1);});
}
function updateSwapHint(){
  $("#swap-hint").classList.toggle("hidden",pendingSwapId===null);
  document.querySelectorAll('[data-player]').forEach(el=>el.classList.toggle('swap-selected',Number(el.dataset.player)===pendingSwapId));
}
function selectSwapTarget(id){
  if(pendingSwapId===null){openPlayer(id);return;}
  if(id===pendingSwapId){pendingSwapId=null;updateSwapHint();toast('Troca cancelada.');return;}
  const a=squad.find(p=>p.id===pendingSwapId),b=squad.find(p=>p.id===id);
  if(!a||!b){pendingSwapId=null;updateSwapHint();return;}
  const starter=a.starter;a.starter=b.starter;b.starter=starter;
  // A ordem visual é armazenada explicitamente para que titulares e reservas troquem de lugar.
  const slot=a.slot;a.slot=b.slot;b.slot=slot;
  pendingSwapId=null;renderSquad();toast(`${a.name.split(' ')[0]} e ${b.name.split(' ')[0]} trocaram de posição.`);
}
function makeSquad(){return initialSquad(selectedClub.id);}

function startCampaign(){
  if(!realRostersLoaded){toast("Elencos ainda não carregados. Abra o jogo por um servidor local.");return;}
  squad=makeSquad(); transferBudget=initialBudget(selectedClub);transferHistory=[];careerFinished=false; Object.keys(setPieceTakers).forEach(k=>setPieceTakers[k]=null);ensureSetPieces(); [...squad].sort(()=>Math.random()-.5).slice(0,5).forEach(p=>p.yellowCards=2); day=1;secondsLeft=300; formation="4-3-3"; calendar=makeCalendar(); initializeLeague(); completedMatchDays.clear(); liveMatch=null; pendingSwapId=null;morale=60;trainedDays=new Set();trainingSelection=new Set();lastTrainingDay={};requestDay=0;marketClock=0;transferOffers=[];incomingOffers=[];marketOfferSeq=0;messages=[{title:"A diretoria te deseja boa sorte!",text:"Você tem uma missão difícil pela frente. Faça o necessário para manter o clube na Série A."}];
  $("#pitch-club-name").textContent=selectedClub.name;
  $("#formation-button").textContent=formation+" ▾";
  $("#my-team-short").textContent=(selectedClub.short||selectedClub.name).toUpperCase();
  $("#campaign-date").textContent="DIA 01 • PREPARAÇÃO";
  renderSquad();renderMessagesDot();updateClock();updateMorale();updateTrainingButton();updateMatchEntry();renderCampaignLeagueStatus();renderHomeStandings();showScreen("campaign-screen");startTimer();
  if(!tutorialSeen)openTutorial();
  toast("Campanha iniciada! Você tem 7 dias para preparar o time.");
}
function renderSquad(){
  const positions=formationPositions();
  const starters=squad.filter(p=>p.starter).sort((a,b)=>a.slot-b.slot).slice(0,11);
  $("#players-on-pitch").innerHTML=starters.map((p,i)=>`<button class="player-token" data-player="${p.id}" style="left:${positions[i].x}%;top:${positions[i].y}%"><span class="player-avatar">${p.shirtNumber}</span><strong>${p.name.split(" ")[0]}</strong><small>${p.pos} • ${p.ovr}</small></button>`).join("");
  $("#bench").innerHTML=squad.filter(p=>!p.starter).sort((a,b)=>a.slot-b.slot).map(p=>`<button class="bench-player" data-player="${p.id}"><span>${p.shirtNumber}</span><strong>${p.name.split(" ")[0]}</strong><small>${p.pos} • ${p.ovr}</small></button>`).join("");
  document.querySelectorAll("[data-player]").forEach(el=>el.addEventListener("click",()=>selectSwapTarget(Number(el.dataset.player))));
  updateSwapHint();
}
function openPlayer(id){
  selectedPlayer=squad.find(p=>p.id===id);const p=selectedPlayer;
  const action=p.starter?`<button class="secondary-button" id="swap-player">🔁 Substituir</button>`:`<button class="secondary-button" id="swap-player">⬆ Colocar em campo</button>`;
  openModal(`<h2>#${p.shirtNumber} ${p.name}</h2><p class="modal-sub">${p.pos} • ${p.age} anos • ${p.starter?"Titular":"Reserva"}</p><div class="detail-grid">
  <div class="detail-stat"><small>Overall</small><strong>${p.ovr}</strong><button class="attribute-view-button" id="view-attributes" type="button">VER</button></div><div class="detail-stat"><small>Condição física</small><strong>${p.condition}%</strong></div><div class="detail-stat"><small>Moral individual</small><strong>${p.morale??60}%</strong></div>
  <div class="detail-stat"><small>Valor de mercado</small><strong>${money(p.value)}</strong></div><div class="detail-stat"><small>Salário mensal</small><strong>${money(p.salary)}</strong></div>
  <div class="detail-stat"><small>Histórico médico</small><strong>${p.injury}${injuryRemaining(p)?` • ${injuryRemaining(p)} dia(s) restante(s)`:''}</strong></div><div class="detail-stat"><small>Cartões</small><strong>${p.yellowCards||0} amarelos${p.yellowCards===2?' • PENDURADO':''}${suspensionRemaining(p)?' • SUSPENSO':''}</strong></div></div><div class="modal-actions">${action}<button class="primary-button" id="done-player">FECHAR</button></div>`);
  $("#view-attributes").addEventListener("click",()=>openPlayerAttributes(p));
  $("#swap-player").addEventListener("click",()=>{pendingSwapId=p.id;closeModal();updateSwapHint();toast("Selecione o jogador com quem deseja trocar.");});
  $("#done-player").addEventListener("click",closeModal);
}
function openPlayerAttributes(p){
 const rows=Object.entries(p.attributes||{}).map(([key,value])=>`<div class="attribute-row"><span>${ATTRIBUTE_LABELS[key]||key}${p.trainingBonuses?.[key]?` <small>+${Math.round(p.trainingBonuses[key]*100)}% treino</small>`:''}</span><div class="attribute-track"><i style="width:${value}%"></i></div><strong>${value}</strong></div>`).join('');
 openModal(`<h2>${p.name}</h2><p class="modal-sub">${p.pos} • Overall ${p.ovr} • Energia ${p.condition}% • Moral ${p.morale??60}%</p><p class="modal-sub">Atributos estimados de jogabilidade, ainda não revisados individualmente. Energia, moral e posição alteram a eficiência nas ações; não modificam o atributo-base mostrado abaixo.</p><div class="attribute-list">${rows}</div><div class="modal-actions"><button id="back-player-attributes" class="secondary-button">VOLTAR AO JOGADOR</button></div>`);
 $("#back-player-attributes").addEventListener("click",()=>openPlayer(p.id));
}
function openModal(content){$("#modal-content").innerHTML=content;$("#modal-backdrop").classList.remove("hidden");}
function closeModal(){$("#modal-backdrop").classList.add("hidden");}
function money(n){return "R$ "+Number(n||0).toLocaleString("pt-BR");}
function startTimer(){clearInterval(timerId);timerId=setInterval(()=>{if(secondsLeft>0){secondsLeft--;marketClock++;updateClock();resolveDueOffers();resolveIncomingCounters();}else{clearInterval(timerId);toast("Seu dia terminou. Avance para o próximo dia.");}},1000);}
function updateClock(){const m=String(Math.floor(secondsLeft/60)).padStart(2,"0"),s=String(secondsLeft%60).padStart(2,"0");$("#clock").textContent=`${m}:${s}`;}
function advanceTime(){advanceMinute();}
function nextDay(){resolveDueOffers();resolveIncomingCounters();if(careerFinished){showCampaignFinale();return;}if(isMatchDay()&&!completedMatchDays.has(day)){toast("Dispute a partida antes de avançar o dia.");return;}day++;marketClock+=300;resolveDueOffers();resolveIncomingCounters();recoverTrainingDay();if(day%3===0)generateIncomingOffer();secondsLeft=300;$("#campaign-date").textContent=`DIA ${String(day).padStart(2,"0")} • ${day<=7?"PREPARAÇÃO":"TEMPORADA"}`;$("#match-info").textContent=day<8?`Preparação • estreia em ${8-day} dia(s)`:"Dia de planejamento • próxima rodada em breve";startTimer();if(day===4)messages.push({title:"Seu auxiliar técnico mandou um relatório",text:"O elenco está treinando. Observe a condição física dos jogadores antes da estreia."});generatePlayerRequests();updateTrainingButton();updateMatchEntry();renderMessagesDot();toast(`Dia ${day} iniciado. Novo período de 5 minutos.`);}
function renderMessagesDot(){$("#message-dot").style.display=messages.length?"block":"none";}
function toast(text){const el=$("#toast");el.textContent=text;el.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove("show"),2600);}
function openMenu(menu){
  resolveDueOffers();
  if(menu==="market"){
    showMarketClubs();
  }else if(menu==="table"){
    openModal(`<h2>🏆 Classificação completa</h2><p class="modal-sub">20 clubes • classificação simulada da campanha, atualizada após cada partida. Não representa a tabela oficial da CBF.</p><div class="simple-list full-table">${fullStandings()}</div>${upcomingRoundSummary()}<details class="league-history"><summary>VER RESULTADOS DAS RODADAS ANTERIORES</summary>${leagueHistorySummary()}</details>`);
  }else if(menu==="messages"){
    resolveIncomingCounters();openModal(`<h2>✉️ Mensagens</h2><p class="modal-sub">Novidades e acontecimentos do seu clube.</p><div class="simple-list">${messages.map(m=>`<div class="list-row"><span>${m.title}<br><small>${m.text}</small></span></div>`).join("")}</div><div class="modal-actions"><button id="messages-negotiations" class="primary-button">ABRIR NEGOCIAÇÕES</button></div>`);document.querySelector('#messages-negotiations').onclick=showMarketNegotiations;
  }else{
    openModal(`<h2>🧢 Meu clube</h2><p class="modal-sub">Resumo da gestão do clube.</p><div class="detail-grid"><div class="detail-stat"><small>Clube</small><strong>${selectedClub.name}</strong></div><div class="detail-stat"><small>Elenco</small><strong>${squad.length} jogadores</strong></div><div class="detail-stat"><small>Formação</small><strong>4-3-3</strong></div><div class="detail-stat"><small>Orçamento</small><strong>${money(transferBudget)}</strong></div></div><div class="modal-actions"><button class="secondary-button" id="season-stats-button">NÚMEROS DA TEMPORADA</button><button class="secondary-button" id="tactics-button">⚽ Instruções táticas</button></div>`);
    const actions=$('#modal-content .modal-actions');
    if(actions){actions.insertAdjacentHTML('afterbegin','<button id="shirt-editor-button" class="secondary-button">NÚMEROS DAS CAMISAS</button><button id="set-piece-button" class="secondary-button">CAPITÃO E COBRADORES</button>');$('#shirt-editor-button').onclick=showShirtEditor;$('#set-piece-button').onclick=showSetPieceEditor;}
    $("#season-stats-button").addEventListener("click",showSeasonStats);
    $("#tactics-button").addEventListener("click",()=>openModal(`<h2>⚽ Instruções táticas</h2><p class="modal-sub">Escolha a postura da equipe. As opções serão conectadas à simulação das partidas nas próximas versões.</p><div class="simple-list">${["Equilibrada","Ofensiva","Defensiva","Contra-ataque"].map(t=>`<button class="list-row tactic-option">${t}<span>›</span></button>`).join("")}</div>`));
    document.querySelectorAll(".tactic-option").forEach(b=>b.addEventListener("click",()=>{toast("Postura selecionada: "+b.textContent.replace("›","").trim());closeModal();}));
  }
}
function showSeasonStats(){
  openModal(`<h2>Números da temporada</h2><p class="modal-sub">Números disponíveis a partir do seu comando no clube.</p><div class="season-stats"><div class="season-stat-row season-stat-head"><span>JOGADOR</span><span>G</span><span>A</span><span class="card-icon yellow" title="Cartões amarelos" aria-label="Cartões amarelos"></span><span class="card-icon red" title="Cartões vermelhos" aria-label="Cartões vermelhos"></span><span>SITUAÇÃO</span></div>${squad.map(p=>`<div class="season-stat-row"><span>${p.name}</span><span>${p.seasonGoals||0}</span><span>${p.seasonAssists||0}</span><span>${p.yellowCards||0}</span><span>${p.redCards||0}</span><span>${suspensionRemaining(p)?'Suspenso':injuryRemaining(p)?'Lesionado':p.yellowCards===2?'Pendurado':'Disponível'}</span></div>`).join("")}</div>`);
}
function showMarketClubs(){
  resolveDueOffers();resolveIncomingCounters();openModal(`<h2>Mercado de transferências</h2><p class="modal-sub">Orçamento: <strong>${money(transferBudget)}</strong> • disponível para propostas: <strong>${money(availableBudget())}</strong>. Negociações feitas pelo dirigente, sem salários ou contratos.</p><div class="modal-actions"><button id="market-negotiations" class="primary-button">MINHAS NEGOCIAÇÕES (${transferOffers.filter(o=>['pending','accepted','counter'].includes(o.status)).length+incomingOffers.filter(o=>o.status==='pending').length})</button></div><div class="market-club-grid">${clubs.map(c=>`<button class="market-club" data-club="${c.id}"><span>${c.symbol||'⚽'}</span><strong>${c.name}</strong></button>`).join('')}</div>`);
  document.querySelectorAll('.market-club').forEach(b=>b.addEventListener('click',()=>showMarketRoster(Number(b.dataset.club))));
  document.querySelector('#market-negotiations').onclick=showMarketNegotiations;
}
function showMarketRoster(clubId){
  const club=clubs.find(c=>c.id===clubId);
  const roster=clubId===selectedClub.id?squad:(marketRosters[clubId]||[]);
  openModal(`<h2>${club.name}</h2><p class="modal-sub">Jogadores da base preliminar • atributos e valores simulados para o jogo</p><div class="simple-list">${roster.length?roster.map(p=>`<div class="list-row"><span>${p.name}<br><small>${p.pos} • OVR ${p.ovr} • ${p.age} anos • ${money(p.value)}</small></span><button class="secondary-button market-detail" data-player="${p.id}">DETALHES</button></div>`).join(''):'<div class="market-empty">O elenco deste clube ainda não foi cadastrado. Nenhum jogador fictício será apresentado como real.</div>'}</div><div class="modal-actions"><button id="market-back" class="secondary-button">VOLTAR AOS CLUBES</button></div>`);
  document.querySelectorAll('.market-detail').forEach(b=>b.addEventListener('click',()=>showMarketPlayer(clubId,Number(b.dataset.player))));
  $('#market-back').addEventListener('click',showMarketClubs);
}
function showMarketPlayer(clubId,playerId){
  const club=clubs.find(c=>c.id===clubId), roster=clubId===selectedClub.id?squad:(marketRosters[clubId]||[]);
  const p=roster.find(x=>x.id===playerId);if(!p)return;
  const own=clubId===selectedClub.id;
  const minimum=transferMinimum(p,club);
  openModal(`<h2>${p.name}</h2><p class="modal-sub">${club.name} • ${p.pos} • ${p.age} anos</p><div class="detail-grid"><div class="detail-stat"><small>Overall</small><strong>${p.ovr}</strong></div><div class="detail-stat"><small>Valor estimado</small><strong>${money(p.value)}</strong></div><div class="detail-stat"><small>Condição física</small><strong>${p.condition??100}%</strong></div><div class="detail-stat"><small>Números na campanha</small><strong>${p.goals||0} gols • ${p.assists||0} assist.</strong></div><div class="detail-stat"><small>Atributos</small><strong>${p.attributes?Object.entries(p.attributes).map(([k,v])=>`${k}: ${v}`).join(' • '):'Não cadastrados'}</strong></div></div>${own?'<p class="modal-sub">Você já comanda este jogador.</p>':`<form id="offer-form" class="offer-form"><label for="offer-value">Valor da proposta (R$) • Disponível: ${money(availableBudget())} • Valor solicitado pelo dirigente: ${money(minimum)}</label><input id="offer-value" type="number" min="1" step="1" max="${availableBudget()}" value="${Math.min(minimum,availableBudget())}" required><button class="primary-button" type="submit">ENVIAR PROPOSTA</button></form>`}<div class="modal-actions"><button class="secondary-button" id="roster-back">VOLTAR AO ELENCO</button></div>`);
  $('#roster-back').addEventListener('click',()=>showMarketRoster(clubId));
  if(!own)$('#offer-form').addEventListener('submit',e=>{e.preventDefault();const value=Number($('#offer-value').value);if(!Number.isFinite(value)||value<=0)return;submitOffer(club,p,value);});
}
function submitOffer(club,p,value){
 resolveDueOffers();
 if(!Number.isSafeInteger(value)||value<=0||value>availableBudget()){toast('Valor inválido ou acima do orçamento disponível.');return;}
 if(transferOffers.some(o=>o.status==='pending'&&o.playerId===p.id)){toast('Já existe proposta pendente por este jogador.');return;}
 const offer={id:++marketOfferSeq,clubId:club.id,clubName:club.name,playerId:p.id,playerName:p.name,amount:value,referenceValue:p.value,status:'pending',createdAt:marketClock,dueAt:marketClock+60};
 transferOffers.push(offer);
 messages.unshift({title:`Proposta enviada: ${p.name}`,text:`Oferta de ${money(value)} enviada ao ${club.name}. A diretoria responderá em aproximadamente um minuto.`});
 renderMessagesDot();closeModal();toast('Proposta enviada ao dirigente.');
 setTimeout(()=>{resolveDueOffers();resolveIncomingCounters();},60000);
}
function isMatchDay(d=day){return calendar.some(m=>m.day===d);}
function updateTrainingButton(){const btn=$('#training-button'),status=$('#training-status');if(!btn)return;const match=isMatchDay(),done=trainedDays.has(day);btn.disabled=match||done;status.textContent=match?'Dia de partida: treinamento indisponível.':done?'Treinamento do dia concluído.':'Escolha 5 jogadores para o treinamento de hoje.';}
function openTraining(){if(isMatchDay()||trainedDays.has(day)){toast('Treinamento indisponível neste dia.');return;}trainingSelection=new Set();trainingType='construcao';renderTraining();}
function renderTraining(){
 const spec=TRAINING_TYPES[trainingType];
 const typeOptions=Object.entries(TRAINING_TYPES).map(([key,v])=>`<option value="${key}" ${key===trainingType?'selected':''}>${v.label}</option>`).join('');
 const eligible=p=>!injuryRemaining(p)&&(trainingType!=='goleiros'||p.pos==='GOL');
 openModal(`<h2>Montar treinamento</h2><p class="modal-sub">Escolha cinco jogadores e a especialidade. O treino altera energia e atributos efetivos nas partidas. Todos os ganhos de atributos são permanentes até o fim da campanha. O treino também provoca desgaste físico.</p><label class="training-type-label">Tipo de treinamento<select id="training-type">${typeOptions}</select></label><p class="modal-sub" id="training-effect">${spec.keys.length?`Ganho permanente de aproximadamente ${Math.round(spec.bonus*100)}% por atributo (mínimo +1, máximo 99) • desgaste -${spec.cost} energia • atributos: ${spec.keys.map(k=>ATTRIBUTE_LABELS[k]||k).join(', ')}`:'Recuperação: +20 de energia, sem ganho técnico.'}</p><div class="training-slots">${Array.from({length:5},(_,i)=>`<div class="training-slot">${[...trainingSelection][i]?escapeHtml(squad.find(p=>p.id===[...trainingSelection][i])?.name||'Vazio'):'Vazio'}</div>`).join('')}</div><div class="training-players">${squad.map(p=>`<button class="training-player ${trainingSelection.has(p.id)?'chosen':''}" data-train="${p.id}" ${!eligible(p)?'disabled':''}>${escapeHtml(p.name)}<small>${p.pos} • Energia ${Math.round(p.condition)}%${injuryRemaining(p)?` • Lesionado (${injuryRemaining(p)} dia(s))`:''}</small></button>`).join('')}</div><div class="modal-actions"><button id="confirm-training" class="primary-button" ${trainingSelection.size!==5?'disabled':''}>CONFIRMAR TREINO (${trainingSelection.size}/5)</button></div>`);
 $('#training-type').addEventListener('change',e=>{trainingType=e.target.value;trainingSelection=new Set([...trainingSelection].filter(id=>eligible(squad.find(p=>p.id===id))));renderTraining();});
 document.querySelectorAll('[data-train]').forEach(b=>b.addEventListener('click',()=>{const id=Number(b.dataset.train);if(trainingSelection.has(id))trainingSelection.delete(id);else if(trainingSelection.size<5)trainingSelection.add(id);renderTraining();}));
 $('#confirm-training').addEventListener('click',()=>{
   if(trainedDays.has(day)||isMatchDay()||trainingSelection.size!==5)return;
   const players=[...trainingSelection].map(id=>squad.find(x=>x.id===id));
   if(players.some(p=>!p||!eligible(p))){toast('Há jogadores indisponíveis para o treino.');return;}
   trainedDays.add(day);
   const results=players.map(p=>applyTraining(p,trainingType));
   messages.unshift({title:`Treinamento de ${TRAINING_TYPES[trainingType].label} — dia ${day}`,text:results.join(' | ')});
   renderMessagesDot();updateTrainingButton();renderSquad();openModal(`<h2>RESULTADO DO TREINAMENTO</h2><p class="modal-sub">Ganhos permanentes até o fim da campanha.</p><div class="simple-list">${results.map(x=>`<div class="list-row">${escapeHtml(x)}</div>`).join('')}</div><div class="modal-actions"><button class="primary-button" id="training-result-close">CONTINUAR</button></div>`);$('#training-result-close').onclick=closeModal;toast('Treinamento concluído! Atributos permanentemente atualizados.');
 });
}
function generatePlayerRequests(){
  if(day<3||day===requestDay)return;requestDay=day;
  const candidates=squad.filter(p=>!p.starter&&day-(lastTrainingDay[p.id]||0)>=3);
  if(candidates.length){const p=candidates[(day-3)%candidates.length];messages.unshift({title:`Pedido de ${p.name}`,text:`Quero mais oportunidades para jogar ou participar dos treinamentos. Pedido registrado; impacto na moral será ativado na etapa de lógica.`});}
}
function confirmNextDay(){if(isMatchDay()&&!completedMatchDays.has(day)){toast("Inicie a partida antes de avançar.");return;}openModal(`<h2>Avançar para o próximo dia?</h2><p class="modal-sub">Você deseja avançar para o dia seguinte? O tempo restante deste dia será encerrado.</p><div class="modal-actions"><button id="cancel-next-day" class="secondary-button">CANCELAR</button><button id="confirm-next-day" class="primary-button">SIM, AVANÇAR</button></div>`);$('#cancel-next-day').addEventListener('click',closeModal);$('#confirm-next-day').addEventListener('click',()=>{closeModal();nextDay();});}

// Calendário planejado: confrontos fictícios entre clubes reais; não representa tabela oficial da CBF.
function generateRoundRobinFixtures(){
 // Método do círculo: 20 clubes, 19 rodadas, 10 jogos por rodada, sem confrontos repetidos.
 const ids=clubs.map(c=>c.id).sort((a,b)=>a-b);
 if(ids.length!==20)return [];
 let order=[...ids];for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}const rounds=[];
 for(let round=0;round<19;round++){
  const matches=[];
  for(let i=0;i<10;i++){
   const left=order[i],right=order[19-i];
   const swap=(round+i)%2===1;
   matches.push({home:swap?right:left,away:swap?left:right});
  }
  rounds.push(matches);
  order=[order[0],order[19],...order.slice(1,19)];
 }
 return rounds;
}
function makeCalendar(){
 leagueFixtures=generateRoundRobinFixtures().slice(0,6);
 const days=[8,12,15,19,22,26];
 return days.map((d,i)=>{
  const fixture=(leagueFixtures[i]||[]).find(f=>f.home===selectedClub.id||f.away===selectedClub.id);
  const opponentId=fixture?.home===selectedClub.id?fixture.away:fixture?.home;
  const opponent=clubs.find(c=>c.id===opponentId);
  return {day:d,opponent:opponent?.name||'A definir',home:fixture?.home===selectedClub.id,round:i+1};
 });
}
function showCalendar(){
 const maxDay=Math.max(28,calendar.at(-1)?.day||28),offset=3; // mês fictício da campanha, iniciando na quarta-feira
 const cells=Array.from({length:Math.ceil((maxDay+offset)/7)*7},(_,i)=>i-offset+1);
 openModal(`<h2>Calendário da campanha</h2><p class="modal-sub">Todos os dias da campanha. Verde: treino • Azul: partida • Roxo: preparação/descanso. Calendário fictício do jogo.</p><div class="calendar-month"><div class="calendar-weekdays">${['DOM','SEG','TER','QUA','QUI','SEX','SÁB'].map(d=>`<b>${d}</b>`).join('')}</div><div class="calendar-month-grid">${cells.map(d=>{const m=calendar.find(x=>x.day===d),valid=d>=1&&d<=maxDay,match=!!m;return `<button class="calendar-day ${!valid?'outside':match?'match-day':d===day?'today':d<day?'past':'training-day'}" ${!valid?'disabled':''} data-day="${d}"><strong>${valid?String(d).padStart(2,'0'):''}</strong>${valid?`<span>${match?(m.home?'CASA':'FORA')+' • '+m.opponent:trainedDays.has(d)?'TREINOU':d===day?'HOJE':'TREINO / LIVRE'}</span>`:''}</button>`;}).join('')}</div></div><div id="calendar-detail" class="calendar-detail">Selecione um dia para consultar a programação.</div>`);
 document.querySelectorAll('.calendar-day[data-day]').forEach(b=>b.addEventListener('click',()=>{const d=Number(b.dataset.day),m=calendar.find(x=>x.day===d);$('#calendar-detail').textContent=m?`Dia ${d}: ${selectedClub.name} x ${m.opponent} (${m.home?'em casa':'fora'}).`:`Dia ${d}: sem jogo. ${trainedDays.has(d)?'Treinamento realizado.':'Treinamento disponível, sujeito às regras do dia.'}`;}));
}
function formationPositions(){
  // Campo horizontal: goleiro à esquerda, defesa, meio e ataque até a direita.
  const layouts={
    "4-3-3":[4,3,3],"4-4-2":[4,4,2],"4-2-3-1":[4,2,3,1],
    "3-5-2":[3,5,2],"5-3-2":[5,3,2],"4-1-4-1":[4,1,4,1]
  };
  const lines=layouts[formation];
  const result=[{x:8,y:50}];
  lines.forEach((count,line)=>{
    const x=lines.length===4 ? [28,46,65,85][line] : [30,56,83][line];
    for(let i=0;i<count;i++) result.push({x,y:50+(i-(count-1)/2)*(count===5?17:count===4?21:count===3?26:count===2?32:0)});
  });
  return result;
}
function chooseFormation(){
  openModal(`<h2>⚽ Formação tática</h2><p class="modal-sub">Selecione o esquema do seu time.</p><div class="simple-list">${formations.map(f=>`<button class="list-row formation-option" data-formation="${f}">${f} ${formation===f?"✓":""}</button>`).join("")}</div>`);
  document.querySelectorAll(".formation-option").forEach(b=>b.addEventListener("click",()=>{
    formation=b.dataset.formation;$("#formation-button").textContent=formation+" ▾";renderSquad();closeModal();
  }));
}
function advanceMinute(){const elapsed=Math.min(60,secondsLeft);secondsLeft=Math.max(0,secondsLeft-60);marketClock+=elapsed;updateClock();resolveDueOffers();resolveIncomingCounters();if(secondsLeft===0)clearInterval(timerId);}

$("#calendar-button").addEventListener("click",showCalendar);
$("#advance-minute").addEventListener("click",advanceMinute);
$("#header-next-day").addEventListener("click",confirmNextDay);
$("#training-button").addEventListener("click",openTraining);
$("#formation-button").addEventListener("click",chooseFormation);
$("#tutorial-help").addEventListener("click",()=>openTutorial());
$("#cancel-swap").addEventListener("click",()=>{pendingSwapId=null;updateSwapHint();});
$("#start-button").addEventListener("click",()=>{showScreen("club-screen");});
$("#back-home").addEventListener("click",()=>showScreen("home-screen"));
$("#confirm-club").addEventListener("click",()=>{if(selectedClub)startCampaign();});
$("#close-modal").addEventListener("click",()=>{if(liveMatch?.phase==='finished'){matchOptions(false,true);return;}if(liveMatch?.phase==='halftime'||liveMatch?.phase==='paused'){matchOptions(liveMatch.phase==='halftime');return;}closeModal();});
$("#modal-backdrop").addEventListener("click",e=>{if(e.target.id==="modal-backdrop"&&!(liveMatch&&['finished','halftime','paused'].includes(liveMatch.phase)))closeModal();});
$("#advance-time").addEventListener("click",advanceTime);
// Botão inferior duplicado removido; o avanço de dia é controlado pelo cabeçalho.
document.querySelectorAll(".menu-button").forEach(b=>b.addEventListener("click",()=>openMenu(b.dataset.menu)));
Promise.all([loadClubs(),loadRealRosters()]).then(()=>console.info("Elencos disponíveis:",Object.values(marketRosters).reduce((n,r)=>n+r.length,0)));


// PARTE 6 — protótipo funcional de partida em etapas. Os resultados NÃO são sorteados previamente.
const completedMatchDays=new Set();
let liveMatch=null,liveTimer=null;
const matchStyles=['Equilibrado','Ofensivo','Recuado','Agressivo','Posse de bola'];
const matchStats=()=>({possession:0,shots:0,onTarget:0,fouls:0,yellows:0,corners:0,saves:0,passes:0,passesCompleted:0});
function updateMatchEntry(){
 const btn=$('#start-match');if(!btn||!selectedClub)return;
 const game=calendar.find(x=>x.day===day);
 btn.classList.toggle('hidden',!game||completedMatchDays.has(day));
 if(game)btn.textContent=completedMatchDays.has(day)?'PARTIDA ENCERRADA':`JOGAR CONTRA ${game.opponent.toUpperCase()}`;
 const next=calendar.find(x=>!completedMatchDays.has(x.day)&&x.day>=day);
 const matchup=document.querySelector('.next-match-card .matchup');
 if(matchup)matchup.innerHTML=next?`<span>${escapeHtml(next.home?selectedClub.name:next.opponent)}</span><b>VS</b><span>${escapeHtml(next.home?next.opponent:selectedClub.name)}</span>`:'<span>TEMPORADA CONCLUÍDA</span>';
 const info=$('#match-info');
 if(info)info.textContent=next?`RODADA ${next.round} • DIA ${String(next.day).padStart(2,'0')} • ${next.home?'EM CASA':'FORA'}${next.day===day?' • HOJE':''}`:'Todos os compromissos foram disputados';
}
function matchLineup(){return squad.filter(p=>p.starter&&playerAvailable(p)&&!liveMatch?.sentOffIds?.has(p.id)&&!liveMatch?.injuredIds?.has(p.id)).sort((a,b)=>a.slot-b.slot).slice(0,11);}
// PARTE 7: a entrada abre o pré-jogo; o motor só inicia após confirmação.
let matchDurationSeconds=60;
function matchStart(){
 const game=calendar.find(x=>x.day===day);if(!game||completedMatchDays.has(day))return;
 if(matchLineup().length<11){toast('Você precisa de 11 titulares disponíveis. Substitua os lesionados.');return;}
 clearInterval(timerId);matchStop();
 const other=clubs.find(c=>c.name===game.opponent),roster=marketRosters[other?.id]||[];
 const cpu=selectCpuEleven(roster);assignShirtNumbers(cpu,other?.id);
 const cpuBench=roster.filter(p=>!cpu.some(x=>x.id===p.id)).map(p=>({...p}));
 const lineupSnapshot=squad.map(p=>({id:p.id,starter:p.starter,slot:p.slot}));
 liveMatch={lineupSnapshot,game,minute:0,half:1,phase:'pregame',home:0,away:0,style:'Equilibrado',cpuStyle:'Equilibrado',cpuFormation:'4-4-2',cpuLastChange:-20,defensiveLine:'Média',pressing:'Normal',tempo:'Normal',individualOrders:{},formation,stats:[matchStats(),matchStats()],feed:[],cpu,cpuBench,cpuSubstitutions:0,cpuUsedIds:new Set(),cpuPlan:{line:'Média',press:'Normal',tempo:'Normal'},cpuRisk:0,substitutions:0,usedSubIds:new Set(),subQueue:[],sentOffIds:new Set(),injuredIds:new Set(),suspendedAtKickoff:squad.filter(p=>suspensionRemaining(p)).map(p=>p.id),sanctionsApplied:false,extra:0,lastAction:0,pendingPenalty:null};
 $('#pregame-home').textContent=selectedClub.name;$('#pregame-away').textContent=game.opponent;
 $('#match-home').textContent=selectedClub.name;$('#match-away').textContent=game.opponent;
 $('#match-title').textContent='BRASILEIRÃO • RETA FINAL';
 $('#pregame-formation').innerHTML=formations.map(f=>`<option ${f===formation?'selected':''}>${f}</option>`).join('');
 $('#pregame-style').innerHTML=matchStyles.map(x=>`<option>${x}</option>`).join('');
 $('#pregame-duration').value='60';
 $('#pregame-view').classList.remove('hidden');$('#arena-view').classList.add('hidden');
 showScreen('match-screen');renderPregameField();
}
function selectCpuEleven(roster){
 const left=[...roster],picked=[];
 for(const pos of ['GOL','ZAG','ZAG','LAT','LAT','VOL','MC','MC','ATA','ATA','ATA']){
  if(!left.length)break;const ix=left.findIndex(p=>p.pos===pos);picked.push(left.splice(ix>=0?ix:0,1)[0]);
 }
 return picked;
}
function formationCoordinates(f,side){
 const lines=({'4-3-3':[4,3,3],'4-4-2':[4,4,2],'4-2-3-1':[4,2,3,1],'3-5-2':[3,5,2],'5-3-2':[5,3,2],'4-1-4-1':[4,1,4,1]})[f]||[4,3,3];
 const xGoal=side===0?7:93, xMin=side===0?20:80, xMax=side===0?45:55;
 const coords=[{x:xGoal,y:50}];
 lines.forEach((count,i)=>{const x=xMin+(xMax-xMin)*(i/Math.max(1,lines.length-1));for(let k=0;k<count;k++)coords.push({x,y:((k+1)/(count+1))*100});});
 return coords;
}
const SDR_KITS={'Grêmio':'#159bd7','Palmeiras':'#087345','Internacional':'#c51e32','Flamengo':'#d52a31','Corinthians':'#f4f4f4','Botafogo':'#ededed','Santos':'#f5f5f5','Vasco':'#f4f4f4','São Paulo':'#f3f3f3','Cruzeiro':'#1749ba','Bahia':'#2575c7','Fluminense':'#751b38','Atlético-MG':'#eeeeee','Athletico-PR':'#cc2430','Bragantino':'#f3f3f3','Chapecoense':'#16763e','Coritiba':'#18753d','Mirassol':'#e6c633','Remo':'#173f85','Vitória':'#ca2531'};
function teamKitColor(side){const name=side===0?selectedClub?.name:liveMatch?.game?.opponent;let color=SDR_KITS[name]||'#eeeeee';if(side===1&&color===SDR_KITS[selectedClub?.name])color='#252a37';return color;}
function teamKitText(side){const color=teamKitColor(side).replace('#','');const r=parseInt(color.slice(0,2),16),g=parseInt(color.slice(2,4),16),b=parseInt(color.slice(4,6),16);return .2126*r+.7152*g+.0722*b>150?'#182326':'#ffffff';}
// Parte 19: os espaços táticos, não a posição natural, determinam a função em campo.
function assignedRole(index,shape='4-3-3'){
 const lines=({'4-3-3':[4,3,3],'4-4-2':[4,4,2],'4-2-3-1':[4,2,3,1],'3-5-2':[3,5,2],'5-3-2':[5,3,2],'4-1-4-1':[4,1,4,1]})[shape]||[4,3,3];
 if(index===0)return 'GOL';let slot=index-1;
 for(let i=0;i<lines.length;i++){if(slot<lines[i])return i===0?'DEF':i===lines.length-1?'ATT':'MID';slot-=lines[i];}
 return 'ATT';
}
function positionalFactor(player,index,shape){
 if(!player)return .1;const pos=player.pos,line=assignedRole(index,shape);
 if(line==='GOL')return pos==='GOL'?1:.08;
 if(pos==='GOL')return .12;
 if(line==='DEF')return ['ZAG','LAT'].includes(pos)?1:pos==='VOL'?.77:pos==='MC'?.52:.30;
 if(line==='MID')return ['VOL','MC'].includes(pos)?1:pos==='LAT'?.78:pos==='ATA'?.60:.50;
 return pos==='ATA'?1:pos==='MC'?.74:pos==='LAT'?.48:.32;
}
function adjustedTeamSkill(players,keys,offense,shape='4-3-3'){
 if(!players.length)return 8;let total=0,weight=0;
 players.forEach((p,i)=>{
  const slot=players===liveMatch?.cpu?i:(Number.isInteger(p.slot)?p.slot:i);const role=assignedRole(slot,shape),factor=positionalFactor(p,slot,shape);
  const importance=role==='GOL'?(offense?.05:.15):role==='DEF'?(offense?.45:1.65):role==='MID'?1.15:(offense?1.75:.35);
  const skill=keys.reduce((sum,k)=>sum+effectiveAttribute(p,k),0)/keys.length;
  total+=skill*factor*importance;weight+=importance;
 });
 return total/weight;
}
function actualKeeper(players){if(players===liveMatch?.cpu)return players[0]||null;return players.find(p=>p.slot===0)||null;}
function keeperRating(players){
 const keeper=actualKeeper(players);if(!keeper)return 5;
 if(keeper.pos!=='GOL')return Math.min(12,keeper.ovr*.13);
 return matchSkill(keeper,['reflexos','defesa_chutes','posicionamento_goleiro','um_contra_um']);
}
function fieldMarkup(own,cpu,ownFormation,otherFormation,animated=false){
 const dots=(players,f,side)=>formationCoordinates(f,side).map((pos,i)=>{
  const player=players[i];if(!player)return '';
  const offset=animated?Math.sin((liveMatch?.minute||0)*.42+i*1.7)*1.3:0;
  const x=Math.max(5,Math.min(95,pos.x+(side===0?offset:-offset)));
  const name=String(player.name||'Jogador').split(' ').slice(-1)[0];
  return `<div class="field-player ${side===0?'home-player':'away-player'}" style="--kit:${teamKitColor(side)};--kit-text:${teamKitText(side)};left:${x}%;top:${pos.y}%" title="${escapeHtml(player.name||'Jogador')}"><span class="player-marker">${player.shirtNumber??(i===0?1:i)}</span><small>${escapeHtml(name)}</small></div>`;
 }).join('');
 return `<div class="field-markings"><div class="field-halfway"></div><div class="field-center-circle"></div><div class="field-box field-box-left"></div><div class="field-box field-box-right"></div><div class="field-goal field-goal-left"></div><div class="field-goal field-goal-right"></div></div>${dots(own,ownFormation,0)}${dots(cpu,otherFormation,1)}${animated?'<div class="field-ball" id="field-ball">⚽</div>':''}`;
}
function renderPregameField(){const m=liveMatch;if(!m)return;
 m.formation=$('#pregame-formation').value;m.style=$('#pregame-style').value;
 $('#pregame-home-formation').textContent=m.formation;$('#pregame-away-formation').textContent='4-4-2';
 $('#pregame-field').innerHTML=fieldMarkup(matchLineup(),m.cpu,m.formation,m.cpuFormation);
}
function beginLiveMatch(){const m=liveMatch;if(!m||m.phase!=='pregame')return;
 matchDurationSeconds=Number($('#pregame-duration').value)||60;
 m.formation=$('#pregame-formation').value;m.style=$('#pregame-style').value;formation=m.formation;
 $('#formation-button').textContent=formation+' ▾';m.phase='running';
 $('#pregame-view').classList.add('hidden');$('#arena-view').classList.remove('hidden');
 matchEvent('Apito inicial! A bola está rolando.');matchRender();matchRun();
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function matchEvent(message){liveMatch.feed.unshift(`${Math.floor(liveMatch.minute)}’ — ${message}`);liveMatch.feed=liveMatch.feed.slice(0,65);}
function avgTeam(players,keys){if(!players.length)return 45;return players.reduce((sum,p)=>sum+keys.reduce((v,k)=>v+effectiveAttribute(p,k),0)/keys.length,0)/players.length;}
// PARTE 11: instruções táticas entram nos cálculos, sem modificar o resultado passado.
function tacticSettings(team){
 const m=liveMatch;
 return team===0?{line:m.defensiveLine,press:m.pressing,tempo:m.tempo,style:m.style,formation:m.formation}:{line:m.cpuPlan?.line||'Média',press:m.cpuPlan?.press||'Normal',tempo:m.cpuPlan?.tempo||'Normal',style:m.cpuStyle,formation:m.cpuFormation};
}
function tacticFactor(team,action){
 const t=tacticSettings(team),attack=action==='attack';
 let f=1;
 if(t.line==='Baixa')f*=attack?.94:1.07;
 if(t.line==='Alta')f*=attack?1.055:.955;
 if(t.press==='Alta')f*=attack?1.015:1.07;
 if(t.press==='Baixa')f*=attack?.96:.99;
 if(t.tempo==='Rápido')f*=attack?1.06:.97;
 if(t.tempo==='Lento')f*=attack?.94:1.035;
 return f;
}
// PARTE 20 — IA adversária reativa. Não altera placares nem sorteia vencedores.
function aiSquadStrength(players,action,shape){
 const keys=action==='attack'?['passe','visao','finalizacao','drible','velocidade']:['marcacao','desarme','interceptacao','posicionamento_defensivo','jogo_aereo'];
 return adjustedTeamSkill(players,keys,action==='attack',shape);
}
function aiTacticalUpdate(){
 const m=liveMatch;if(!m||m.phase!=='running')return;
 const diff=m.away-m.home,minute=m.minute,late=minute>=65;
 const own=matchLineup(),cpu=m.cpu;
 const ownAttack=aiSquadStrength(own,'attack',m.formation),cpuDefense=aiSquadStrength(cpu,'defend',m.cpuFormation);
 const ownDefense=aiSquadStrength(own,'defend',m.formation),cpuAttack=aiSquadStrength(cpu,'attack',m.cpuFormation);
 const weakOwnDefense=ownDefense<cpuAttack-7,weakOwnAttack=ownAttack<cpuDefense-7;
 const ownAggressive=m.style==='Ofensivo'||m.style==='Agressivo'||m.pressing==='Alta';
 const ownCautious=m.style==='Recuado'||m.defensiveLine==='Baixa';
 let style='Equilibrado',shape='4-4-2',line='Média',press='Normal',tempo='Normal';
 if(diff<=-2||(diff<0&&minute>=55)){
  style='Ofensivo';shape='4-3-3';line='Alta';press='Alta';tempo='Rápido';
 }else if(diff>0&&late){
  style='Recuado';shape='5-3-2';line='Baixa';press='Normal';tempo='Lento';
 }else if(diff<0||ownCautious){
  style='Posse de bola';shape='4-2-3-1';line='Alta';press='Normal';tempo='Rápido';
 }else if(ownAggressive){
  style='Equilibrado';shape='4-4-2';line='Baixa';press='Normal';tempo='Rápido';
 }else if(weakOwnDefense){
  style='Ofensivo';shape='4-3-3';press='Alta';tempo='Rápido';
 }else if(weakOwnAttack){
  style='Posse de bola';shape='4-2-3-1';press='Alta';
 }
 // Não permite que a IA mude a cada lance: decisões têm janela mínima.
 const change=style!==m.cpuStyle||shape!==m.cpuFormation||line!==m.cpuPlan.line||press!==m.cpuPlan.press||tempo!==m.cpuPlan.tempo;
 if(change&&minute-m.cpuLastChange>=12){
  m.cpuStyle=style;m.cpuFormation=shape;m.cpuPlan={line,press,tempo};m.cpuLastChange=minute;
  matchEvent(`${m.game.opponent} ajusta para ${shape}, postura ${style.toLowerCase()}, pressão ${press.toLowerCase()} e ritmo ${tempo.toLowerCase()}.`);
 }
 m.cpuRisk=diff<0&&late?1:0;
}
function aiSubstitutionUpdate(){
 const m=liveMatch;if(!m||m.phase!=='running'||m.minute<48||m.cpuSubstitutions>=5)return;
 if(m.minute%7!==0&&m.minute!==45)return;
 const candidates=m.cpu.map((p,i)=>({p,i})).filter(x=>x.i>0&&x.p.condition<=(m.minute>=75?77:68));
 if(!candidates.length)return;
 candidates.sort((a,b)=>a.p.condition-b.p.condition);
 const out=candidates[0];
 const role=assignedRole(out.i,m.cpuFormation);
 const replacements=m.cpuBench.filter(p=>p.pos!=='GOL'&&!m.cpuUsedIds.has(p.id));
 if(!replacements.length)return;
 const fit=p=>positionalFactor(p,out.i,m.cpuFormation);
 replacements.sort((a,b)=>(fit(b)*b.ovr*(.65+.35*(b.condition||100)/100))-(fit(a)*a.ovr*(.65+.35*(a.condition||100)/100)));
 const incoming=replacements[0];
 if(fit(incoming)<.5||incoming.condition<out.p.condition+10)return;
 m.cpu[out.i]=incoming;m.cpuBench=m.cpuBench.filter(p=>p.id!==incoming.id);
 m.cpuUsedIds.add(incoming.id);m.cpuSubstitutions++;
 matchEvent(`SUBSTITUIÇÃO ${m.game.opponent}: sai ${out.p.name} (${Math.round(out.p.condition)}% de energia), entra ${incoming.name}.`);
}

// PARTE 23 — condicionamento, confiança, disciplina e coesão tática.
// Os efeitos são simétricos: usuário e CPU utilizam as mesmas regras.
function matchTeamContext(team){
 const m=liveMatch,players=team===0?matchLineup():m.cpu;
 const shape=team===0?m.formation:m.cpuFormation;
 const fit=players.length?players.reduce((v,p,i)=>v+positionalFactor(p,team===0?(Number.isInteger(p.slot)?p.slot:i):i,shape),0)/players.length:.25;
 const stamina=players.length?players.reduce((v,p)=>v+Math.max(8,Math.min(100,Number(p.condition??100))),0)/players.length:20;
 const mood=players.length?players.reduce((v,p)=>v+Math.max(0,Math.min(100,Number(p.morale??60))),0)/players.length:50;
 const score=team===0?m.home:m.away,conceded=team===0?m.away:m.home;
 const confidence=matchClamp(1+(score-conceded)*.018,.94,1.06);
 // Coesão depende da adequação dos atletas às funções, não de sorteio arbitrário.
 const cohesion=matchClamp(.86+fit*.14,.87,1);
 const fitness=matchClamp(.72+stamina*.0028,.74,1);
 const mentality=matchClamp(.93+mood*.00115,.94,1.045);
 return {fitness,mentality,cohesion,confidence,stamina,fit};
}
function matchTacticalExertion(team){
 const t=tacticSettings(team);
 let cost=t.style==='Agressivo'?1.38:t.style==='Ofensivo'?1.19:t.style==='Recuado'?.82:1;
 if(t.press==='Alta')cost*=1.26;else if(t.press==='Baixa')cost*=.88;
 if(t.tempo==='Rápido')cost*=1.13;else if(t.tempo==='Lento')cost*=.90;
 if(t.line==='Alta')cost*=1.07;
 return cost;
}
function matchHalftimeRecovery(){
 const m=liveMatch;
 for(const p of [...matchLineup(),...m.cpu]){
  const recovery=2.5+(Number(p.attributes?.resistencia??65)/100)*2;
  p.condition=Math.min(100,Math.round((p.condition+recovery)*10)/10);
 }
 matchEvent('No intervalo, os jogadores recuperam parte da energia.');
}
function teamPower(team,action){const m=liveMatch;const players=team===0?matchLineup():m.cpu;const offense=action==='attack';const keys=offense?['passe','visao','finalizacao','drible','velocidade']:['marcacao','desarme','interceptacao','posicionamento_defensivo','jogo_aereo'];const stat=adjustedTeamSkill(players,keys,offense,team===0?m.formation:m.cpuFormation);const style=team===0?m.style:m.cpuStyle;const mod=offense?({Ofensivo:1.13,Recuado:.85,Agressivo:1.02,'Posse de bola':1.06,Equilibrado:1}[style]):({Ofensivo:.91,Recuado:1.12,Agressivo:1.05,'Posse de bola':.98,Equilibrado:1}[style]);const form=team===0?m.formation:m.cpuFormation;const formationMod=offense?({'4-3-3':1.05,'5-3-2':.91,'3-5-2':1.03}[form]||1):({'5-3-2':1.08,'4-2-3-1':1.03,'4-3-3':.97}[form]||1);const context=matchTeamContext(team);return stat*mod*formationMod*tacticFactor(team,action)*context.fitness*context.mentality*context.cohesion*context.confidence;}
function matchTick(){const m=liveMatch;if(!m||m.phase!=='running')return;m.minute++;if(m.minute%6===0)aiTacticalUpdate();if(m.minute%7===0)aiSubstitutionUpdate();const own=matchLineup();[...own,...m.cpu].forEach(p=>{const side=own.includes(p)?0:1;const drain=.66*matchTacticalExertion(side)*(1.2-(p.attributes?.resistencia??65)/220);p.condition=Math.max(8,Math.round((p.condition-drain)*10)/10);});if(m.minute%2===0)matchAction();if(m.phase!=='running')return;if(m.minute===45&&m.half===1){m.phase='halftime';matchStop();matchHalftimeRecovery();matchEvent('Intervalo! Os times vão para os vestiários.');matchRender();matchOptions(true);return;}if(m.minute>=90&&m.half===2){m.phase='finished';matchStop();completedMatchDays.add(day);recordLeagueRound(m);processSuspensionsAfterMatch(m);applyMatchSanctions(m);consumeMatchTrainingBonus();const diff=m.home-m.away;morale=Math.max(0,Math.min(100,morale+(diff>0?6:diff<0?-5:1)));own.forEach(p=>p.morale=Math.max(0,Math.min(100,(p.morale??60)+(diff>0?4:diff<0?-3:1))));matchEvent('Fim de jogo!');matchRender();matchOptions(false,true);return;}matchRender();}
// PARTE 10 — resolução de ações individuais; cada disputa consulta atributos efetivos.
function matchClamp(v,low=.04,high=.96){return Math.max(low,Math.min(high,v));}
function matchSkill(p,keys){return keys.reduce((sum,key)=>sum+effectiveAttribute(p,key),0)/keys.length;}
// PARTE 21 — Duelo individual por função ocupada, sem selecionar goleiro como atacante.
function deployedSlot(players,player){
 const index=players.indexOf(player);
 if(index<0)return -1;
 // Jogadores humanos preservam o slot original mesmo após expulsões.
 return players===liveMatch?.cpu?index:(Number.isInteger(player.slot)?player.slot:index);
}
function deployedRole(players,player){
 const shape=players===liveMatch?.cpu?liveMatch.cpuFormation:liveMatch?.formation||'4-3-3';
 return assignedRole(deployedSlot(players,player),shape);
}
function duelRating(player,keys,role,players){
 const idx=deployedSlot(players,player),shape=players===liveMatch?.cpu?liveMatch.cpuFormation:liveMatch?.formation||'4-3-3';
 const fit=positionalFactor(player,idx,shape);
 const value=matchSkill(player,keys);
 return Math.max(3,value*fit);
}
function weightedChoice(players,score){
 const weights=players.map(p=>Math.max(0.1,score(p)));
 let roll=Math.random()*weights.reduce((a,b)=>a+b,0);
 for(let i=0;i<players.length;i++){roll-=weights[i];if(roll<=0)return players[i];}
 return players[players.length-1]||null;
}
function matchWeightedPlayer(players,role){
 const pool=players.filter(p=>deployedRole(players,p)!=='GOL'&&p.pos!=='GOL');
 if(!pool.length)return null;
 return weightedChoice(pool,p=>{
  const line=deployedRole(players,p);
  const keys=role==='creator'?['passe','visao','dominio']:role==='finisher'?['finalizacao','frieza','dominio']:role==='marker'?['marcacao','posicionamento_defensivo','interceptacao']:['desarme','interceptacao','velocidade'];
  const factor=role==='finisher'?(line==='ATT'?2.3:line==='MID'?.8:.22):role==='creator'?(line==='MID'?1.7:line==='ATT'?1.1:.65):role==='marker'?(line==='DEF'?1.65:line==='MID'?1.05:.5):1;
  return Math.pow(duelRating(p,keys,role,players)/70,2)*factor;
 });
}
function duelChance(attacker,defender,attackKeys,defenseKeys,attackPlayers,defensePlayers,base=.5,scale=.012){
 const attack=duelRating(attacker,attackKeys,'attack',attackPlayers);
 const defense=duelRating(defender,defenseKeys,'defend',defensePlayers);
 return matchClamp(base+(attack-defense)*scale,.07,.92);
}
// PARTE 22: perfis de oportunidade, criados antes da finalização.
// Todas as chances continuam passando pelos duelos individuais da Parte 21.
const CHANCE_PROFILES={
 normal:{label:'jogada trabalhada',shot:0,goal:0,keeper:0,finish:['finalizacao','frieza','dominio']},
 counter:{label:'contra-ataque',shot:.055,goal:.055,keeper:0,finish:['finalizacao','velocidade','frieza']},
 long:{label:'chute de longe',shot:-.14,goal:-.09,keeper:.015,finish:['finalizacao','forca_chute','frieza']},
 aerial:{label:'cabeceio',shot:-.045,goal:.01,keeper:0,finish:['jogo_aereo','finalizacao','frieza']},
 clear:{label:'chance clara',shot:.12,goal:.13,keeper:0,finish:['finalizacao','frieza','dominio']},
 corner:{label:'escanteio',shot:-.09,goal:-.015,keeper:0,finish:['jogo_aereo','finalizacao','posicionamento_ofensivo']},
 freekick:{label:'cobrança de falta',shot:-.07,goal:-.04,keeper:0,finish:['bola_parada','finalizacao','frieza']}
};
function chooseChanceProfile(attacking,defending){
 const m=liveMatch,offense=teamPower(attacking,'attack'),defense=teamPower(defending,'defend');
 const style=attacking===0?m.style:m.cpuStyle;
 const weight={normal:38,counter:style==='Recuado'?24:style==='Ofensivo'?9:16,long:13,aerial:13,clear:Math.max(4,11+(offense-defense)*.15)};
 const total=Object.values(weight).reduce((a,b)=>a+b,0);let roll=Math.random()*total;
 for(const [name,w] of Object.entries(weight)){roll-=w;if(roll<=0)return name;}return 'normal';
}
function chanceFinisher(players,kind){
 if(kind==='aerial'||kind==='corner'){
  const pool=players.filter(p=>deployedRole(players,p)!=='GOL'&&p.pos!=='GOL');
  return weightedChoice(pool,p=>Math.max(.1,duelRating(p,['jogo_aereo','posicionamento_ofensivo','finalizacao'],'finisher',players)/65));
 }
 return matchWeightedPlayer(players,'finisher');
}
function resolveShot(attacking,defending,shooter,passer,tackler,kind){
 const m=liveMatch,teams=[matchLineup(),m.cpu],creators=teams[attacking],defenders=teams[defending];
 const side=attacking===0?selectedClub.name:m.game.opponent,profile=CHANCE_PROFILES[kind]||CHANCE_PROFILES.normal;
 const attackPlan=teamPower(attacking,'attack'),defensePlan=teamPower(defending,'defend');
 const finish=duelRating(shooter,profile.finish,'finish',creators);
 const blocking=duelRating(tackler,['posicionamento_defensivo','marcacao','interceptacao'],'block',defenders);
 const shotChance=matchClamp(.46+(finish-blocking)*.003+Math.tanh((attackPlan-defensePlan)/35)*.055+profile.shot,.20,.82);
 m.stats[attacking].shots++;
 if(Math.random()>shotChance){
  if(kind!=='corner'&&Math.random()<.18){m.stats[attacking].corners++;matchEvent(`ESCANTEIO para ${side}! ${tackler.name} desvia o chute de ${shooter.name}.`);resolveSetPiece(attacking,'corner');}
  else matchEvent(`${side}: ${shooter.name} tenta ${profile.label}, mas a finalização sai sem direção.`);
  return;
 }
 m.stats[attacking].onTarget++;
 const goalkeeper=actualKeeper(defenders),keeperSkill=keeperRating(defenders);
 const goalChance=matchClamp(.24+(finish-keeperSkill)*.0028+Math.tanh((attackPlan-defensePlan)/35)*.045+profile.goal,.055,goalkeeper?.pos==='GOL'?.57:.77);
 if(Math.random()<goalChance){
  if(attacking===0)m.home++;else m.away++;
  shooter.goals=(shooter.goals||0)+1;
  if(attacking===0){shooter.seasonGoals=(shooter.seasonGoals||0)+1;if(passer&&passer!==shooter&&passer.id!==shooter.id){passer.assists=(passer.assists||0)+1;passer.seasonAssists=(passer.seasonAssists||0)+1;}}
  matchEvent(`GOOOOOOL! ${shooter.name} marca para ${side} em ${profile.label}!${passer&&passer!==shooter&&passer.id!==shooter.id?` Assistência de ${passer.name}.`:''}`);
 }else{
  m.stats[defending].saves++;
  if(kind!=='corner'&&Math.random()<.17){m.stats[attacking].corners++;matchEvent(`ESCANTEIO para ${side}! ${goalkeeper?.name||'O goleiro'} espalma a tentativa de ${shooter.name}!`);resolveSetPiece(attacking,'corner');}
  else matchEvent(`DEFESA! ${goalkeeper?.name||'O goleiro'} evita o gol de ${shooter.name} (${profile.label}).`);
 }
}
function resolveSetPiece(attacking,kind){
 const m=liveMatch,defending=1-attacking,teams=[matchLineup(),m.cpu],creators=teams[attacking],defenders=teams[defending];
 const side=attacking===0?selectedClub.name:m.game.opponent;
 if(!creators.length||!defenders.length)return;
 const taker=attacking===0?creators.find(p=>p.id===setPieceTakers[kind==='corner'?'corner':'freeKick']):null;
 const passer=taker||matchWeightedPlayer(creators,'creator');
 const shooter=kind==='corner'?chanceFinisher(creators,'corner'):(taker||matchWeightedPlayer(creators,'finisher'));
 const marker=matchWeightedPlayer(defenders,'marker');if(!shooter||!marker)return;
 // Nem toda bola parada gera finalização; a marcação pode afastar a bola.
 const delivery=passer?duelRating(passer,kind==='corner'?['cruzamento','bola_parada']:['bola_parada','finalizacao'],'creator',creators):45;
 const coverage=duelRating(marker,['jogo_aereo','marcacao','posicionamento_defensivo'],'marker',defenders);
 const creation=matchClamp(.42+(delivery-coverage)*.0025,.25,.62);
 if(Math.random()>creation){matchEvent(`${side}: ${kind==='corner'?'escanteio':'falta'} cobrado, mas ${marker.name} afasta o perigo.`);return;}
 resolveShot(attacking,defending,shooter,kind==='corner'?passer:null,marker,kind);
}
function matchAction(){
 const m=liveMatch;
 const own=matchLineup(),teams=[own,m.cpu];
 const attacking=Math.random()<matchClamp(.5+Math.tanh((teamPower(0,'attack')-teamPower(1,'defend')-teamPower(1,'attack')+teamPower(0,'defend'))/85)*.19,.30,.70)?0:1;
 const defending=1-attacking,side=attacking===0?selectedClub.name:m.game.opponent;
 const creators=teams[attacking],defenders=teams[defending];if(!creators.length||!defenders.length)return;
 m.stats[attacking].possession++;
 m.stats[attacking].passes++;
 const passer=matchWeightedPlayer(creators,'creator'),marker=matchWeightedPlayer(defenders,'marker');if(!passer||!marker)return;
 const passerSkill=duelRating(passer,['passe','visao','dominio'],'creator',creators);
 const coverage=duelRating(marker,['interceptacao','marcacao','posicionamento_defensivo'],'marker',defenders);
 const attackPlan=teamPower(attacking,'attack'),defensePlan=teamPower(defending,'defend');
 const passChance=matchClamp(.76+(passerSkill-coverage)*.0026+Math.tanh((attackPlan-defensePlan)/35)*.055,.52,.91);
 if(Math.random()>passChance){
  if(Math.random()<.65)matchEvent(`${marker.name} intercepta o passe de ${passer.name} e corta a jogada de ${side}.`);
  return;
 }
 m.stats[attacking].passesCompleted++;
 const chanceKind=chooseChanceProfile(attacking,defending);
 const shooter=chanceFinisher(creators,chanceKind),tackler=matchWeightedPlayer(defenders,'marker');if(!shooter||!tackler)return;
 const drive=duelRating(shooter,['drible','dominio','aceleracao'],'dribble',creators);
 const challenge=duelRating(tackler,['desarme','marcacao','posicionamento_defensivo'],'tackle',defenders);
 const pressure=matchClamp(.51+(drive-challenge)*.003+Math.tanh((attackPlan-defensePlan)/35)*.06,.29,.72);
 if(Math.random()>pressure){
  if(Math.random()<.48)matchEvent(`${tackler.name} desarma ${shooter.name} e impede a finalização.`);
  if(Math.random()<.002)matchInjury(shooter,'play');
  // A falta nasce de uma disputa concreta, não de sorteio isolado.
  const aggressive=(defending===0?m.style:m.cpuStyle)==='Agressivo';
  const order=defending===0?(m.individualOrders[tackler.id]||'Normal'):'Normal';
  const foulChance=matchClamp(.11+(aggressive?.075:0)+(order==='Falta tática'?.085:order==='Cauteloso'?-.025:0)+(45-effectiveAttribute(tackler,'frieza'))*.0007+(tackler.condition<35?.035:0),.025,.31);
  if(Math.random()<foulChance){
   m.stats[defending].fouls++;
   const yellowChance=matchClamp(.13+(aggressive?.13:0)+(order==='Falta tática'?.11:order==='Cauteloso'?-.04:0)+(35-effectiveAttribute(tackler,'desarme'))*.001+(tackler.condition<40?.035:0),.07,.46);
   if(Math.random()<yellowChance){
    m.stats[defending].yellows++;
    const discipline=matchDiscipline(tackler);discipline.yellow++;
    matchEvent(`CARTÃO AMARELO! ${tackler.name} recebe advertência por falta em ${shooter.name}.`);
    if(discipline.yellow>=2){discipline.red=true;m.sentOffIds.add(tackler.id);if(defending===1)m.cpu=m.cpu.filter(p=>p!==tackler);matchEvent(`EXPULSO! ${tackler.name} recebe o segundo amarelo e deixa o campo.`);}
   }
   else matchEvent(`Falta de ${tackler.name} em ${shooter.name}.`);
   matchInjury(shooter,'foul');
   if(Math.random()<.055){matchEvent('Falta dentro da área! Pênalti assinalado!');startPenalty(attacking);}
   else if(Math.random()<.24){matchEvent(`Boa oportunidade de bola parada para ${side}.`);resolveSetPiece(attacking,'freekick');}
  }
  return;
 }
 resolveShot(attacking,defending,shooter,passer,tackler,chanceKind);
}

function playSubstitutionQueue(done){
 const m=liveMatch;if(!m)return;matchStop();m.phase='substitution';matchRender();
 const next=()=>{if(!m.subQueue.length){$('#match-overlay').classList.add('hidden');done();return;}
 const sub=m.subQueue.shift();const box=$('#match-overlay');box.classList.remove('hidden');
 box.innerHTML=`<div class="sub-board"><small>SUBSTITUIÇÃO • ${escapeHtml(selectedClub.name)}</small><div class="sub-board-numbers"><div class="sub-out"><b>${sub.out.number}</b><span>SAI</span><strong>${escapeHtml(sub.out.name)}</strong></div><div class="sub-in"><b>${sub.incoming.number}</b><span>ENTRA</span><strong>${escapeHtml(sub.incoming.name)}</strong></div></div></div>`;
 setTimeout(next,2100);
 };next();
}
function startPenalty(attacking){
 const m=liveMatch;if(!m||m.phase!=='running')return;
 matchStop();m.phase='penalty';
 const takers=attacking===0?matchLineup():m.cpu;
 const preferred=attacking===0?takers.find(p=>p.id===setPieceTakers.penalty):null;
 const shooter=preferred||[...takers].sort((a,b)=>(b.attributes?.finalizacao||b.ovr)-(a.attributes?.finalizacao||a.ovr))[0];
 m.pendingPenalty={attacking,shooterId:shooter.id};
 $('#penalty-scene').classList.remove('hidden');$('#penalty-scene').innerHTML=`<div class="penalty-scene-inner"><div class="penalty-heading">PÊNALTI! • ${escapeHtml(attacking===0?selectedClub.name:m.game.opponent)}</div><div class="penalty-goal"><div class="penalty-goalkeeper">🧤</div><div id="penalty-result" class="penalty-result"></div></div><div class="penalty-spot">⚽</div><p id="penalty-taker-name">Batedor: #${shooter.shirtNumber} ${escapeHtml(shooter.name)}</p><div class="penalty-actions">${attacking===0?'<button id="change-penalty-taker" class="secondary-button">ALTERAR BATEDOR</button>':''}<button id="take-penalty" class="primary-button">COBRAR PÊNALTI</button></div></div>`;
 if(attacking===0)$('#change-penalty-taker').onclick=()=>{
  const options=takers.map(p=>`<option value="${p.id}" ${p.id===m.pendingPenalty.shooterId?'selected':''}>#${p.shirtNumber} ${escapeHtml(p.name)}</option>`).join('');
  $('#penalty-taker-name').innerHTML=`<label>Escolha o batedor <select id="penalty-taker-select">${options}</select></label>`;
  $('#penalty-taker-select').onchange=e=>m.pendingPenalty.shooterId=Number(e.target.value);
 };
 $('#take-penalty').onclick=()=>{
  const shooter=takers.find(p=>p.id===m.pendingPenalty.shooterId)||takers[0];const keeper=actualKeeper(attacking===0?m.cpu:matchLineup());
  const finish=effectiveAttribute(shooter,'finalizacao'),cold=effectiveAttribute(shooter,'frieza'),save=keeper?(keeper.pos==='GOL'?effectiveAttribute(keeper,'penaltis'):8):5;
  const probability=Math.max(.48,Math.min(.92,.73+(finish-70)*.002+(cold-70)*.0015-(save-70)*.002));
  const goal=Math.random()<probability;
  if(goal){if(attacking===0)m.home++;else m.away++;shooter.goals=(shooter.goals||0)+1;matchEvent(`GOOOOOOOOOOOOOOOOOOL! Pênalti convertido por ${shooter.name}!`);}else matchEvent(`PÊNALTI PERDIDO! ${shooter.name} não converteu!`);
  m.stats[attacking].shots++;if(goal)m.stats[attacking].onTarget++;
  $('#take-penalty').disabled=true;const change=$('#change-penalty-taker');if(change)change.disabled=true;
  $('#penalty-result').textContent=goal?'GOOOOOOOOOOOOOOOL!':'✕';$('#penalty-result').className='penalty-result '+(goal?'penalty-scored':'penalty-missed');
  setTimeout(()=>{$('#penalty-scene').classList.add('hidden');m.pendingPenalty=null;m.phase='running';matchRender();matchRun();},2300);
 };
}
function matchRun(){matchStop();liveTimer=setInterval(matchTick,Math.round(matchDurationSeconds*1000/90));}
function matchStop(){clearInterval(liveTimer);liveTimer=null;}
function matchRender(){
 const m=liveMatch;if(!m)return;
 $('#match-score').textContent=`${m.home} × ${m.away}`;
 $('#match-clock').textContent=`${String(m.minute).padStart(2,'0')}:00 • ${m.half}º TEMPO${m.phase==='paused'?' • PAUSADO':m.phase==='halftime'?' • INTERVALO':''}`;
 $('#match-feed').innerHTML=m.feed.slice(0,10).map(x=>`<p>${escapeHtml(x)}</p>`).join('');

 $('#match-pause').disabled=m.phase!=='running';
 $('#arena-field').innerHTML=fieldMarkup(matchLineup(),m.cpu,m.formation,m.cpuFormation,true);
 const ball=$('#field-ball');if(ball){ball.style.left=`${Math.max(8,Math.min(92,50+Math.sin(m.minute*.31)*33))}%`;ball.style.top=`${Math.max(12,Math.min(88,50+Math.cos(m.minute*.24)*28))}%`;}
 const last=m.feed[0]||'A bola está rolando.';
 $('#arena-event').textContent=last;
 $('#arena-event').classList.toggle('goal-event',/GOOOL/i.test(last));
 $('#arena-event').classList.toggle('card-event',/cartão/i.test(last));
}

function matchPause(){if(!liveMatch||liveMatch.phase!=='running')return;liveMatch.phase='paused';matchStop();matchRender();matchOptions(false);}
function matchStatPanel(m,final=false){
 const a=m.stats[0],b=m.stats[1],total=a.possession+b.possession;
 const data=[['Posse de bola',total?Math.round(a.possession/total*100):50,total?Math.round(b.possession/total*100):50,'%'],['Finalizações',a.shots,b.shots,''],['Chutes no gol',a.onTarget,b.onTarget,''],['Escanteios',a.corners,b.corners,''],['Faltas',a.fouls,b.fouls,''],['Cartões amarelos',a.yellows,b.yellows,''],['Defesas',a.saves,b.saves,''],['Passes certos',a.passesCompleted,b.passesCompleted,'']];
 return `<section class="match-report"><div class="report-eyebrow">${final?'RESULTADO FINAL':'ANÁLISE DA PARTIDA'} · ${m.minute}'</div><div class="report-score"><span>${escapeHtml(selectedClub.name)}</span><strong>${m.home} <i>×</i> ${m.away}</strong><span>${escapeHtml(m.game.opponent)}</span></div><div class="report-head"><span>CASA</span><span>ESTATÍSTICAS</span><span>FORA</span></div><div class="report-stats">${data.map(([label,left,right,suffix])=>{const sum=left+right||1;return `<div class="report-stat"><div class="report-values"><b>${left}${suffix}</b><span>${label}</span><b>${right}${suffix}</b></div><div class="report-bars"><span style="width:${left/sum*100}%"></span><span style="width:${right/sum*100}%"></span></div></div>`}).join('')}</div><div class="report-events"><strong>ÚLTIMOS ACONTECIMENTOS</strong>${m.feed.slice(0,4).map(x=>`<p>${escapeHtml(x)}</p>`).join('')||'<p>Sem acontecimentos registrados.</p>'}</div></section>`;
}
function showCareerSummary(){
 const ranking=sortedLeague(),pos=ranking.findIndex(r=>r.club.id===selectedClub.id)+1,own=leagueRecords.get(selectedClub.id);
 const games=leagueResults.filter(r=>r.home===selectedClub.name||r.away===selectedClub.name);
 openModal(`<div class="career-summary"><h2>CARREIRA ENCERRADA</h2><p class="modal-sub">${escapeHtml(selectedClub.name)} • seis rodadas decisivas</p><div class="detail-grid"><div class="detail-stat"><small>Posição final</small><strong>${pos}º</strong></div><div class="detail-stat"><small>Pontos finais</small><strong>${own?.points??0}</strong></div><div class="detail-stat"><small>Vitórias na reta final</small><strong>${games.filter(r=>{const [a,b]=r.score.split(' × ').map(Number);return r.home===selectedClub.name?a>b:a<b}).length}</strong></div><div class="detail-stat"><small>Transferências realizadas</small><strong>${transferHistory.length}</strong></div><div class="detail-stat"><small>Orçamento restante</small><strong>${money(transferBudget)}</strong></div></div><h3>Seus resultados</h3><div class="simple-list">${games.map(r=>`<div class="list-row">${escapeHtml(r.home)} ${r.score} ${escapeHtml(r.away)}</div>`).join('')}</div><div class="modal-actions"><button id="career-new" class="primary-button">NOVA CAMPANHA</button><button id="career-home" class="secondary-button">MENU PRINCIPAL</button></div></div>`);
 $('#career-new').onclick=()=>{closeModal();showScreen('club-screen');};
 $('#career-home').onclick=()=>{closeModal();showScreen('home-screen');};
}
function showCampaignFinale(){
 const pos=sortedLeague().findIndex(r=>r.club.id===selectedClub.id)+1,escaped=pos<=16;
 openModal(`<div class="campaign-finale ${escaped?'survived':'relegated'}"><div class="finale-symbol">${escaped?'🏆':'🛡️'}</div><h2>${escaped?'ESCAPOU!':'CAIU!'}</h2><p>${escaped?'SEU TIME ESTÁ GARANTIDO NA SÉRIE A DO BRASILEIRÃO!':'VOCÊ NÃO CONSEGUIU SALVAR O SEU CLUBE DO REBAIXAMENTO.'}</p><strong>${escapeHtml(selectedClub.name)} • ${pos}º lugar</strong><div class="modal-actions"><button id="finale-new" class="primary-button">NOVA CAMPANHA</button><button id="finale-career" class="secondary-button">VER CARREIRA</button></div></div>`);
 $('#finale-new').onclick=()=>{closeModal();showScreen('club-screen');};
 $('#finale-career').onclick=showCareerSummary;
}
function matchOptions(halftime=false,finished=false){
 const m=liveMatch;if(!m)return;
 if(finished){openModal(`${matchStatPanel(m,true)}<div class="modal-actions"><button id="end-standings" class="secondary-button">VER CLASSIFICAÇÃO</button><button id="end-match" class="primary-button">VOLTAR À CAMPANHA</button></div>`);$('#end-standings').onclick=()=>{openMenu('table');};$('#end-match').onclick=()=>{m.phase='archived';for(const saved of m.lineupSnapshot||[]){const player=squad.find(p=>p.id===saved.id);if(player){player.starter=saved.starter;player.slot=saved.slot;}}liveMatch=null;closeModal();if(completedMatchDays.size>=6){careerFinished=true;showCampaignFinale();return;}showScreen('campaign-screen');renderSquad();updateMorale();updateMatchEntry();renderCampaignLeagueStatus();renderHomeStandings();startTimer();};return;}
 openModal(`${matchStatPanel(m)}<div class="modal-actions"><button id="open-game-plan" class="secondary-button">⚽ PLANO DE JOGO</button><button id="live-resume" class="primary-button">${halftime?'INICIAR SEGUNDO TEMPO':'RETOMAR PARTIDA'}</button></div>`);
 $('#open-game-plan').onclick=()=>openLiveGamePlan(halftime);
 $('#live-resume').onclick=()=>resumeLiveMatch(halftime);
}
function resumeLiveMatch(halftime){
 const m=liveMatch;if(!m)return;
 formation=m.formation;$('#formation-button').textContent=formation+' ▾';
 if(halftime){m.half=2;m.minute=45;}
 closeModal();
 const start=()=>{m.phase='running';matchEvent(`Jogo retomado. ${selectedClub.name}: ${m.formation}, estilo ${m.style}.`);matchRender();matchRun();};
 if(m.subQueue.length)playSubstitutionQueue(start);else start();
}
function openLiveGamePlan(halftime,selectedId=null){
 const m=liveMatch;if(!m)return;
 const own=matchLineup();const positions=formationCoordinates(m.formation,0).map(pt=>({x:Math.max(9,Math.min(91,pt.x)),y:Math.max(9,Math.min(91,pt.y))}));
 const options=(arr,current)=>arr.map(x=>`<option value="${escapeHtml(x)}" ${x===current?'selected':''}>${escapeHtml(x)}</option>`).join('');
 const pitch=own.map((p,i)=>{const pt=positions[i]||{x:50,y:50};return `<button type="button" class="plan-player ${selectedId===p.id?'active':''}" style="left:${pt.x}%;top:${pt.y}%" data-player="${p.id}" title="${escapeHtml(p.name)}"><span class="plan-shirt">${p.shirtNumber||i+1}</span><strong>${escapeHtml(p.name.split(' ').slice(-1)[0])}</strong><small>${p.ovr} · ${Math.round(p.condition)}%</small></button>`}).join('');
 const current=own.find(p=>p.id===selectedId);
 openModal(`<div class="plan-title"><span>PLANO DE JOGO</span><strong>${escapeHtml(selectedClub.name)}</strong><small>${m.formation} · ${m.substitutions}/5 substituições</small></div><div class="plan-layout"><div class="plan-pitch">${pitch}</div><div class="plan-controls"><label>Esquema<select id="live-formation">${options(formations,m.formation)}</select></label><label>Estilo<select id="live-style">${options(matchStyles,m.style)}</select></label><label>Linha defensiva<select id="live-line">${options(['Baixa','Média','Alta'],m.defensiveLine)}</select></label><label>Pressão<select id="live-press">${options(['Baixa','Normal','Alta'],m.pressing)}</select></label><label>Ritmo<select id="live-tempo">${options(['Lento','Normal','Rápido'],m.tempo)}</select></label><div class="plan-selected">${current?`<strong>#${current.shirtNumber} ${escapeHtml(current.name)}</strong><small>${current.pos} · OVR ${current.ovr} · Energia ${Math.round(current.condition)}%</small><label>Instrução individual<select id="live-order">${options(['Normal','Cauteloso','Falta tática'],m.individualOrders[current.id]||'Normal')}</select></label><button class="secondary-button" id="live-order-save">SALVAR INSTRUÇÃO</button>`:'<p>Selecione um jogador no campo para dar uma instrução individual.</p>'}</div><div class="plan-sub"><strong>SUBSTITUIÇÕES (${m.substitutions}/5)</strong><label>Sai<select id="live-out"><option value="">Selecionar titular</option>${own.map(p=>`<option value="${p.id}" ${p.id===selectedId?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select></label><label>Entra<select id="live-in"><option value="">Selecionar reserva</option>${squad.filter(p=>!p.starter&&playerAvailable(p)).map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select></label><button class="secondary-button" id="live-sub">CONFIRMAR SUBSTITUIÇÃO</button></div></div></div><div class="modal-actions"><button id="plan-back" class="secondary-button">VOLTAR ÀS ESTATÍSTICAS</button><button id="plan-resume" class="primary-button">${halftime?'INICIAR SEGUNDO TEMPO':'RETOMAR PARTIDA'}</button></div>`);
 const save=()=>{m.formation=$('#live-formation').value;m.style=$('#live-style').value;m.defensiveLine=$('#live-line').value;m.pressing=$('#live-press').value;m.tempo=$('#live-tempo').value;};
 document.querySelectorAll('.plan-player').forEach(b=>b.onclick=()=>{save();openLiveGamePlan(halftime,Number(b.dataset.player));});
 $('#live-formation').onchange=()=>{save();openLiveGamePlan(halftime,selectedId);};
 if(current)$('#live-order-save').onclick=()=>{save();m.individualOrders[current.id]=$('#live-order').value;toast('Instrução individual salva.');openLiveGamePlan(halftime,current.id);};
 $('#live-sub').onclick=()=>{save();const out=squad.find(p=>p.id===Number($('#live-out').value)),incoming=squad.find(p=>p.id===Number($('#live-in').value));if(!out||!incoming||out.id===incoming.id||!out.starter||incoming.starter){toast('Escolha titular e reserva válidos.');return;}if(m.substitutions>=5){toast('Limite de cinco substituições atingido.');return;}out.starter=false;incoming.starter=true;delete m.individualOrders[out.id];const oldSlot=out.slot;out.slot=incoming.slot;incoming.slot=oldSlot;m.substitutions++;m.subQueue.push({out:{name:out.name,number:out.shirtNumber},incoming:{name:incoming.name,number:incoming.shirtNumber}});matchEvent(`${incoming.name} entra no lugar de ${out.name}.`);openLiveGamePlan(halftime,incoming.id);};
 $('#plan-back').onclick=()=>{save();matchOptions(halftime);};
 $('#plan-resume').onclick=()=>{save();resumeLiveMatch(halftime);};
}

$('#start-match').addEventListener('click',matchStart);
$('#match-pause').addEventListener('click',matchPause);

// PARTE 7: comandos exclusivos da preparação
$('#pregame-formation').addEventListener('change',renderPregameField);
$('#pregame-style').addEventListener('change',renderPregameField);
$('#pregame-start').addEventListener('click',beginLiveMatch);
$('#pregame-back').addEventListener('click',()=>{matchStop();liveMatch=null;$('#pregame-view').classList.add('hidden');showScreen('campaign-screen');startTimer();});

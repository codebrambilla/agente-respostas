// Consulta da Bella (pagina estatica): a mesma conversa do Teams, no navegador.
// Seguranca:
//  - o endereco da funcao e fixo; a politica da pagina tambem so deixa falar com ele;
//  - todo texto que vem da funcao entra como texto (textContent), nunca como
//    HTML: o markdown da Bella (negrito, listas, links) e montado aqui, peca a peca;
//  - link so abre se for https;
//  - o codigo de acesso (pessoal: a Bella da no chat pessoal do Teams) fica so
//    neste navegador (localStorage); a conversa, so nesta aba (sessionStorage);
//  - a resposta aparece enquanto a Bella escreve (stream); numeros de solicitacao
//    e codigos do SAP viram botao; listas podem ser baixadas em planilha (CSV).
"use strict";

const API = "https://zweuntyaeelxnktllxqc.supabase.co/functions/v1/consultar";
const TEMPO_LIMITE_MS = 90000;  // a IA pode consultar varias coisas antes de responder
const $ = (id) => document.getElementById(id);
const el = (tag, props, ...filhos) => {
  const e = Object.assign(document.createElement(tag), props || {});
  e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== ""));
  return e;
};

const guardar = (onde, chave, valor) => { try { onde.setItem(chave, valor); } catch (e) { /* sem armazenamento */ } };
const ler = (onde, chave) => { try { return onde.getItem(chave) || ""; } catch (e) { return ""; } };
const novoId = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

let codigo = ler(localStorage, "consulta-codigo");
let nome = ler(localStorage, "consulta-nome");          // dono do codigo pessoal ("" = codigo do time)
// o navegador (para "as minhas") e a conversa desta aba
let navegador = ler(localStorage, "consulta-navegador");
if (!navegador) { navegador = novoId(); guardar(localStorage, "consulta-navegador", navegador); }
let sessao = ler(sessionStorage, "consulta-sessao");
if (!sessao) { sessao = novoId(); guardar(sessionStorage, "consulta-sessao", sessao); }

// historico desta aba: [{de: "pessoa"|"bella", texto, mensagem?, verMais?, ficha?}]
let historico = [];
try { historico = JSON.parse(ler(sessionStorage, "consulta-historico") || "[]"); } catch (e) { historico = []; }
const salvar = () => guardar(sessionStorage, "consulta-historico", JSON.stringify(historico.slice(-60)));

// ------------------------------------------------------------ chamadas

class ErroConsulta extends Error {}

// O relogio vale ate o fim do corpo (no stream, a resposta inteira); depois, abortar nao faz nada.
async function pedir(params, corpo) {
  const controle = new AbortController();
  setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let r;
  try {
    r = await fetch(`${API}?${new URLSearchParams(params)}`, {
      method: corpo ? "POST" : "GET",
      headers: corpo ? { "x-codigo": codigo, "content-type": "application/json" } : { "x-codigo": codigo },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controle.signal, cache: "no-store", referrerPolicy: "no-referrer",
    });
  } catch (e) {
    throw new ErroConsulta(e.name === "AbortError" ? "a resposta demorou demais" : "sem conexão com a consulta");
  }
  if (r.status === 401) { sair(); throw new ErroConsulta("código de acesso inválido"); }
  if (!r.ok) {
    let d = {};
    try { d = await r.json(); } catch (e) { /* resposta sem corpo */ }
    throw new ErroConsulta(typeof d.erro === "string" ? d.erro : `erro ${r.status}`);
  }
  return r;
}

async function chamar(params, corpo) {
  const r = await pedir(params, corpo);
  try { return await r.json(); } catch (e) { return {}; }
}

// Conversa em stream: texto aos pedacos (aoEvento) e, no fim, a resposta completa.
// Sem IA ou com "situacao da 3951" a funcao responde JSON, como antes.
async function conversarAoVivo(corpo, aoEvento) {
  const r = await pedir({ conversa: 1, stream: 1 }, corpo);
  if (!(r.headers.get("content-type") || "").includes("event-stream")) {
    try { return await r.json(); } catch (e) { return {}; }
  }
  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let resto = "", fim = null;
  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      resto += dec.decode(value, { stream: true }).replace(/\r/g, "");
      let i;
      while ((i = resto.indexOf("\n\n")) >= 0) {
        let evento = "message", dados = "";
        for (const l of resto.slice(0, i).split("\n")) {
          if (l.startsWith("event:")) evento = l.slice(6).trim();
          else if (l.startsWith("data:")) dados += l.slice(5).trim();
        }
        resto = resto.slice(i + 2);
        if (!dados) continue;
        const d = JSON.parse(dados);
        if (evento === "fim") fim = d;
        else if (evento === "erro") throw new ErroConsulta(typeof d.erro === "string" ? d.erro : "erro na resposta");
        else aoEvento(evento, d);
      }
    }
  } catch (e) {
    if (e instanceof ErroConsulta) throw e;
    throw new ErroConsulta(e.name === "AbortError" ? "a resposta demorou demais" : "a conexão caiu no meio da resposta");
  }
  if (!fim) throw new ErroConsulta("a resposta veio incompleta");
  return fim;
}

// ------------------------------------------------------------ markdown da Bella -> DOM (sem innerHTML)

// Numero de solicitacao e codigo do SAP viram botao: o clique pergunta a Bella.
// O codigo ainda tem "copiar" (para colar no SAP ou no Webformat).
function botaoSolicitacao(n) {
  return el("button", { type: "button", className: "ref", textContent: n, title: `Ver a situação da ${n}`,
    onclick: () => enviar(`situação da ${n}`) });
}

function botaoCodigo(c) {
  const copiar = el("button", { type: "button", className: "copiar", title: "Copiar o código", ariaLabel: `Copiar o código ${c}`, textContent: "⧉" });
  copiar.onclick = async () => {
    try {
      await navigator.clipboard.writeText(c);
      copiar.textContent = "✓";
      copiar.title = "Copiado!";
    } catch (e) {
      copiar.textContent = "✗";
    }
    setTimeout(() => { copiar.textContent = "⧉"; copiar.title = "Copiar o código"; }, 1500);
  };
  return el("span", { className: "ref-codigo" },
    el("button", { type: "button", className: "ref", textContent: c, title: `O que é o ${c}?`, onclick: () => enviar(`o que é o ${c}?`) }),
    copiar);
}

// "solicitação 4779", "solicitações 4779, 4780 e 4781" e códigos do SAP (10 dígitos, 1 ou 2 na frente)
function comReferencias(t, ligar) {
  if (!ligar) return [document.createTextNode(t)];
  const re = /(solicita(?:ç|c)(?:ão|ao|ões|oes)\s+(?:n[º°.]?\s*)?)(\d{3,6}(?:(?:,\s*|\s+e\s+)\d{3,6})*)|\b([12]\d{9})\b/gi;
  const partes = [];
  let fim = 0, m;
  while ((m = re.exec(t))) {
    if (m.index > fim) partes.push(document.createTextNode(t.slice(fim, m.index)));
    if (m[3]) partes.push(botaoCodigo(m[3]));
    else {
      partes.push(document.createTextNode(m[1]));
      for (const p of m[2].split(/(\d+)/)) if (p) partes.push(/^\d+$/.test(p) ? botaoSolicitacao(p) : document.createTextNode(p));
    }
    fim = re.lastIndex;
  }
  if (fim < t.length) partes.push(document.createTextNode(t.slice(fim)));
  return partes;
}

// **4779** no começo de um item ("**4779** · VALVULA...") ou logo depois de "solicitação"
const numeroDeSolicitacao = (m, linha, inicioDeItem) => /^\d{3,6}$/.test(m[1]) && (
  (inicioDeItem && m.index === 0 && /^(\s*[·—–:(-]|\s*$)/.test(linha.slice(m.index + m[0].length))) ||
  /solicita\S*\s+(?:n[º°.]?\s*)?$/i.test(linha.slice(0, m.index)));

// **negrito**, *italico* ou _italico_, `codigo` e [texto](https://...)
function trechos(linha, ligar, inicioDeItem) {
  const partes = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(?<![\w*])[_*](?![\s_*])(.+?)(?<!\s)[_*](?![\w*])|`([^`]+)`/g;
  let fim = 0, m;
  while ((m = re.exec(linha))) {
    if (m.index > fim) partes.push(...comReferencias(linha.slice(fim, m.index), ligar));
    if (m[1] !== undefined) {
      partes.push(ligar && numeroDeSolicitacao(m, linha, inicioDeItem)
        ? el("strong", {}, botaoSolicitacao(m[1])) : el("strong", {}, ...trechos(m[1], ligar)));
    } else if (m[2] !== undefined) partes.push(el("a", { href: m[3], textContent: m[2], target: "_blank", rel: "noopener noreferrer" }));
    else if (m[4] !== undefined) partes.push(el("em", {}, ...trechos(m[4], ligar)));
    else partes.push(el("code", {}, ...comReferencias(m[5], ligar)));
    fim = re.lastIndex;
  }
  if (fim < linha.length) partes.push(...comReferencias(linha.slice(fim), ligar));
  return partes;
}

function markdown(md, ligar = false) {
  const blocos = [];
  let lista = null, par = null;
  const fechar = () => { lista = null; par = null; };
  for (const bruta of String(md || "").split("\n")) {
    const linha = bruta.trimEnd();
    if (!linha.trim()) { fechar(); continue; }
    const item = linha.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!lista) { lista = el(/^\s*\d/.test(linha) ? "ol" : "ul"); blocos.push(lista); par = null; }
      lista.append(el("li", {}, ...trechos(item[1], ligar, true)));
      continue;
    }
    lista = null;
    if (!par) { par = el("p"); blocos.push(par); } else par.append(el("br"));
    par.append(...trechos(linha.replace(/^#{1,4}\s+/, ""), ligar));
  }
  return blocos;
}

// ------------------------------------------------------------ ficha de uma solicitacao (leitor do Webformat)

const CAMPOS_FICHA = ["Descrição longa", "Descrição curta", "Tipo de material", "PDM", "Grupo de mercadorias",
  "Grupo de compradores", "Classe de avaliação", "NCM", "Classe", "Nº de classe", "UAR", "Código definitivo",
  "Dados complementares", "Fabricante", "Referência", "Unidade de medida", "Bem patrimonial", "Urgente",
  "Motivo da urgência"];
const LARGOS = new Set(["Descrição longa", "Tipo de material", "PDM", "Dados complementares", "Motivo da urgência"]);

function valorRico(v) {
  return v.split(/\*\*(.+?)\*\*/).map((pedaco, i) =>
    i % 2 ? el("strong", { textContent: pedaco }) : el("span", { className: "valor-extra", textContent: pedaco }));
}

function situacaoDe(andamento) {
  const t = andamento.join(" ");
  const parada = t.match(/Está parada com (.+?) há (.+?)\./);
  if (/^Concluída/m.test(andamento.join("\n"))) return ["concluida", "Concluída"];
  if (andamento.some((l) => l.startsWith("Cancelada"))) return ["cancelada", "Cancelada"];
  if (parada) return ["andamento", `Parada há ${parada[2]}`];
  return ["andamento", "Em andamento"];
}

function montarFicha(md, numero) {
  const pars = String(md || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const cab = pars.length ? pars[0].match(/^\*\*Solicitação (\d+)\*\*(?: · (.*))?$/) : null;
  if (!cab) return el("div", {}, ...markdown(md || `Não consegui ler a solicitação ${numero} agora.`, true));
  const campos = [], andamento = [];
  for (const p of pars.slice(1)) {
    const m = p.match(/^([^:*]{2,30}): (.+)$/s);
    if (m && CAMPOS_FICHA.includes(m[1])) campos.push([m[1], m[2]]);
    else andamento.push(p.replace(/\*\*/g, ""));
  }
  const [classe, rotulo] = situacaoDe(andamento);
  const partes = [el("div", { className: "ficha-topo" },
    el("div", {},
      el("p", { className: "ficha-numero", textContent: `Solicitação ${cab[1]}` }),
      cab[2] ? el("h3", { className: "ficha-titulo", textContent: cab[2] }) : null),
    andamento.length ? el("span", { className: `ficha-situacao ${classe}`, textContent: rotulo }) : null)];
  if (andamento.length) {
    partes.push(el("ol", { className: "linha-tempo", ariaLabel: "Andamento" },
      ...andamento.map((l) => el("li", { className: /^(Motivo|Antes disso)/.test(l) ? "detalhe" : "", textContent: l }))));
  }
  if (campos.length) {
    partes.push(el("dl", { className: "ficha-campos" }, ...campos.map(([rot, val]) =>
      el("div", { className: "campo" + (LARGOS.has(rot) ? " largo" : "") + (rot === "Código definitivo" && /\d{5,}/.test(val) ? " codigo" : "") },
        el("dt", { textContent: rot }),
        el("dd", {}, ...(rot === "Código definitivo" ? comReferencias(val.replace(/\*\*/g, ""), true) : valorRico(val)))))));
  }
  return el("div", { className: "ficha" }, ...partes);
}

// ------------------------------------------------------------ mensagens na tela

// A conversa rola dentro da propria caixa (a tela fica parada). Enquanto a Bella
// escreve, so acompanha se a pessoa estiver no fim (se subiu para ler, fica onde esta).
const rolar = (sempre = true) => requestAnimationFrame(() => {
  const c = $("conversa");
  if (sempre || c.scrollHeight - c.scrollTop - c.clientHeight < 140) c.scrollTo({ top: c.scrollHeight, behavior: sempre ? "smooth" : "auto" });
});

function avatar() {
  return el("img", { className: "avatar", src: "img/favicon.png", alt: "", width: 32, height: 32 });
}

function botoesAvaliar(m) {
  if (!m.mensagem) return null;
  const caixa = el("div", { className: "avaliar" });
  if (m.avaliada) {
    caixa.append(el("span", { className: "obrigada", textContent: "Obrigada pelo retorno! 💙" }));
    return caixa;
  }
  const votar = async (reacao) => {
    for (const b of caixa.querySelectorAll("button")) b.disabled = true;
    try {
      await chamar({ avaliacao: 1 }, { sessao, mensagem: m.mensagem, reacao });
      m.avaliada = reacao;
      salvar();
      caixa.replaceChildren(el("span", { className: "obrigada", textContent: "Obrigada pelo retorno! 💙" }));
    } catch (e) {
      for (const b of caixa.querySelectorAll("button")) b.disabled = false;
    }
  };
  caixa.append(
    el("button", { type: "button", className: "voto", title: "Ajudou", ariaLabel: "Ajudou", textContent: "👍", onclick: () => votar("like") }),
    el("button", { type: "button", className: "voto", title: "Não ajudou", ariaLabel: "Não ajudou", textContent: "👎", onclick: () => votar("dislike") }));
  return caixa;
}

// "Baixar planilha": a lista completa do que a Bella consultou, em CSV (abre no Excel)
function botaoPlanilha(x) {
  const qtd = Number(x.total) || 0;
  const rotulo = `📥 Baixar planilha (${qtd > 5000 ? "5.000 de " : ""}${qtd.toLocaleString("pt-BR")} ${x.tipo === "sap" ? "códigos" : "solicitações"})`;
  const b = el("button", { type: "button", className: "sugestao planilha", textContent: rotulo, title: "Abre no Excel" });
  b.onclick = async () => {
    b.disabled = true;
    b.textContent = "Montando a planilha…";
    try {
      const r = await pedir({ exportar: 1 }, x.tipo === "sap" ? { tipo: "sap", texto: x.texto } : { tipo: "solicitacoes", pergunta: x.pergunta });
      const arquivo = await r.blob();
      const hoje = new Date().toLocaleDateString("sv-SE");
      const a = el("a", { href: URL.createObjectURL(arquivo), download: `bella-${x.tipo === "sap" ? "sap" : "solicitacoes"}-${hoje}.csv` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      b.textContent = rotulo;
    } catch (e) {
      b.textContent = `Não consegui montar a planilha (${e instanceof ErroConsulta ? e.message : "erro inesperado"}). Tentar de novo`;
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

function desenhar(m) {
  if (m.de === "pessoa") {
    return el("div", { className: "msg da-pessoa" }, el("div", { className: "balao" }, ...markdown(m.texto)));
  }
  const corpo = m.ficha ? [montarFicha(m.texto, m.ficha)] : markdown(m.texto, !m.erro);
  const extras = [];
  if (m.verMais || m.exportar) {
    extras.push(el("div", { className: "sugestoes" },
      m.verMais ? el("button", { type: "button", className: "sugestao", textContent: "Ver mais", onclick: () => enviar("ver mais") }) : null,
      m.exportar ? botaoPlanilha(m.exportar) : null));
  }
  return el("div", { className: "msg da-bella" + (m.erro ? " erro" : "") }, avatar(),
    el("div", { className: "coluna" }, el("div", { className: "balao" }, ...corpo), ...extras, botoesAvaliar(m)));
}

function adicionar(m) {
  historico.push(m);
  $("ideias")?.remove();
  salvar();
  const n = desenhar(m);
  $("conversa").append(n);
  rolar();
  return n;
}

function digitando(texto) {
  const n = el("div", { className: "msg da-bella digitando" }, avatar(),
    el("div", { className: "balao" }, el("span", { className: "pontinhos", ariaHidden: "true" }, el("i"), el("i"), el("i")),
      el("span", { className: "digitando-texto", textContent: texto || "Bella está digitando…" })));
  $("conversa").append(n);
  rolar();
  return n;
}

// poucos atalhos, discretos, e so na conversa vazia (somem na primeira pergunta)
const EXEMPLOS = [
  "quantas com a CH há mais de 48 h úteis?", "já existe válvula gaveta DN 100?", "como estão as minhas?",
];

function boasVindas() {
  return el("div", { className: "msg da-bella" }, avatar(),
    el("div", { className: "coluna" },
      el("div", { className: "balao" },
        el("p", {}, nome ? `Oi, ${nome}! ` : "Oi! ", "Sou a ", el("strong", { textContent: "Bella" }),
          " 😊 Pergunte do seu jeito sobre solicitações do Webformat, materiais do SAP ou dúvidas do cadastro."),
        nome ? null : el("p", { className: "dica" }, "🔐 Você entrou com o código do time, que vai deixar de valer. Peça o seu código pessoal no chat pessoal comigo no Teams: ",
          el("em", { textContent: "“qual o meu código de acesso?”" }))),
      historico.length ? null : el("div", { className: "ideias", id: "ideias" }, ...EXEMPLOS.map((q) =>
        el("button", { type: "button", className: "ideia", textContent: q, onclick: () => enviar(q) })))));
}

function redesenhar() {
  $("conversa").replaceChildren(boasVindas(), ...historico.map(desenhar));
  rolar();
}

// ------------------------------------------------------------ conversa

let ocupado = false;
let espera = 0;

// "situação da 3951": o leitor do Webformat responde em segundos (ou minutos, se precisar acordar)
async function acompanhar(d, aviso) {
  const minha = ++espera;
  const texto = aviso.querySelector(".digitando-texto");
  texto.textContent = d.leitor_vivo ? `Lendo a solicitação ${d.numero} no Webformat…`
    : d.nuvem ? `Buscando a solicitação ${d.numero} no Webformat. Pode levar uns 2 minutos…`
    : `O leitor do Webformat está desligado. A pergunta ficou na fila: deixe a página aberta que a resposta aparece aqui.`;
  let fim = Date.now() + (d.leitor_vivo ? 3 : d.nuvem ? 8 : 30) * 60 * 1000;
  let acordou = !!d.nuvem;
  while (Date.now() < fim && minha === espera) {
    await new Promise((ok) => setTimeout(ok, 1500));
    let p;
    try { p = await chamar({ pedido: d.pedido }); } catch (e) { continue; }
    if (p.nuvem && !acordou) {
      acordou = true;
      fim = Math.max(fim, Date.now() + 8 * 60 * 1000);
      texto.textContent = `Está demorando mais que o normal. Buscando a solicitação ${d.numero} de outro jeito, mais uns 2 minutos…`;
    }
    if (p.status === "respondido" || p.status === "erro") {
      aviso.remove();
      adicionar({ de: "bella", texto: p.resposta || "", ficha: d.numero });
      return;
    }
  }
  aviso.remove();
  if (minha === espera) adicionar({ de: "bella", texto: "O Webformat não respondeu a tempo 😕 Tente de novo em alguns minutos.", erro: true });
}

// enquanto a IA consulta (o texto escrito ate ali sai da tela)
const CONSULTANDO = {
  consultar_solicitacoes: "Consultando as solicitações…", minhas_solicitacoes: "Procurando as suas solicitações…",
  procurar_solicitante: "Procurando o seu nome no Webformat…", confirmar_solicitante: "Guardando o seu nome…",
  ver_solicitacao: "Abrindo a solicitação…", ajuda_pendencia: "Abrindo a solicitação…",
  catalogo_sap: "Procurando no catálogo do SAP…", buscar_material: "Olhando o histórico de materiais…",
  evolucao_da_fila: "Olhando a evolução da fila…",
};
const rotuloConsulta = (fs) => CONSULTANDO[(fs || [])[0]] || "Consultando a base de conhecimento…";

async function enviar(texto) {
  texto = String(texto || "").trim();
  if (!texto || ocupado || !codigo) return;
  ocupado = true;
  $("enviar").disabled = true;
  adicionar({ de: "pessoa", texto });
  const aviso = digitando();
  // a resposta aparecendo enquanto a Bella escreve
  let vivo = null, textoVivo = "", quadro = 0;
  const mostrar = () => {
    quadro = 0;
    if (vivo) { vivo.balao.replaceChildren(...markdown(textoVivo)); rolar(false); }
  };
  const aoEvento = (evento, d) => {
    if (evento === "texto") {
      textoVivo += d.t || "";
      if (!vivo) {
        aviso.hidden = true;
        const balao = el("div", { className: "balao" });
        vivo = { no: el("div", { className: "msg da-bella escrevendo" }, avatar(), el("div", { className: "coluna" }, balao)), balao };
        $("conversa").append(vivo.no);
      }
      if (!quadro) quadro = requestAnimationFrame(mostrar);
    } else if (evento === "consultando") {
      textoVivo = "";
      if (vivo) { vivo.no.remove(); vivo = null; }
      aviso.hidden = false;
      aviso.querySelector(".digitando-texto").textContent = rotuloConsulta(d.ferramentas);
      rolar();
    }
  };
  const limpar = () => {
    if (quadro) cancelAnimationFrame(quadro);
    quadro = 0;
    if (vivo) vivo.no.remove();
    vivo = null;
  };
  try {
    const d = await conversarAoVivo({ sessao, navegador, texto }, aoEvento);
    limpar();
    if (d.pedido) {
      aviso.hidden = false;
      await acompanhar(d, aviso);
    } else {
      aviso.remove();
      adicionar({ de: "bella", texto: d.resposta || "", mensagem: d.mensagem || null, verMais: !!d.ver_mais,
        exportar: d.exportar && typeof d.exportar === "object" ? d.exportar : null });
    }
  } catch (e) {
    limpar();
    aviso.remove();
    adicionar({ de: "bella", erro: true,
      texto: `Não consegui responder agora (${e instanceof ErroConsulta ? e.message : "erro inesperado"}). Tente de novo em instantes.` });
  } finally {
    ocupado = false;
    $("enviar").disabled = false;
    $("mensagem").focus();
  }
}

function novaConversa() {
  espera++;
  historico = [];
  salvar();
  sessao = novoId();
  guardar(sessionStorage, "consulta-sessao", sessao);
  redesenhar();
  $("mensagem").focus();
}

// ------------------------------------------------------------ telas e eventos

function telas() {
  document.body.classList.toggle("logado", !!codigo);
  $("form-codigo").hidden = !!codigo;
  $("como-entrar").hidden = !!codigo;
  if (codigo) $("erro-codigo").hidden = true;
  $("chat").hidden = !codigo;
  $("sair").hidden = !codigo;
  if (codigo) { redesenhar(); $("mensagem").focus(); } else $("codigo").focus();
}

function sair() {
  codigo = "";
  nome = "";
  try { localStorage.removeItem("consulta-codigo"); localStorage.removeItem("consulta-nome"); } catch (e) { /* ok */ }
  espera++;
  telas();
}

// De quem e o codigo (o nome aparece no "Oi, Luiz!"); codigo que deixou de valer sai.
async function quemSou() {
  const d = await chamar({ quem: 1 });
  nome = typeof d.nome === "string" ? d.nome : "";
  guardar(localStorage, "consulta-nome", nome);
}

$("form-codigo").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const c = $("codigo").value.trim();
  if (!c) return;
  const botao = $("form-codigo").querySelector("button");
  botao.disabled = true;
  $("erro-codigo").hidden = true;
  codigo = c;
  try {
    await quemSou();
    guardar(localStorage, "consulta-codigo", c);
    $("codigo").value = "";
    telas();
  } catch (e) {
    codigo = "";
    $("erro-codigo").textContent = e instanceof ErroConsulta && e.message === "código de acesso inválido"
      ? "Código não reconhecido. Peça o seu à Bella no chat pessoal do Teams: “qual o meu código de acesso?”"
      : `Não consegui entrar agora (${e instanceof ErroConsulta ? e.message : "erro inesperado"}).`;
    $("erro-codigo").hidden = false;
    telas();
  } finally {
    botao.disabled = false;
  }
});

$("form-chat").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const t = $("mensagem").value;
  if (!t.trim() || ocupado) return;
  $("mensagem").value = "";
  ajustarAltura();
  enviar(t);
});

// Enter envia; Shift+Enter quebra a linha
$("mensagem").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    $("form-chat").requestSubmit();
  }
});
function ajustarAltura() {
  const t = $("mensagem");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
}
$("mensagem").addEventListener("input", ajustarAltura);

$("nova").addEventListener("click", novaConversa);
$("sair").addEventListener("click", sair);
telas();
// ja tinha entrado: confere o codigo e o nome (o codigo do time vale ate virar so pessoal)
if (codigo) quemSou().then(() => { if (codigo && !ocupado) redesenhar(); }, () => {});

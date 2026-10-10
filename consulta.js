// Consulta da Bella (pagina estatica). Seguranca:
//  - o endereco da funcao e fixo (antes um ?api= na URL podia mandar o codigo
//    de acesso para outro servidor); a politica da pagina tambem so deixa
//    falar com ele;
//  - todo texto que vem da funcao entra como texto (textContent), nunca como
//    HTML: nada do banco de dados vira codigo na pagina;
//  - o codigo de acesso fica so neste navegador (localStorage).
"use strict";

const API = "https://zweuntyaeelxnktllxqc.supabase.co/functions/v1/consultar";
const TEMPO_LIMITE_MS = 20000;
const $ = (id) => document.getElementById(id);
const el = (tag, props, ...filhos) => {
  const e = Object.assign(document.createElement(tag), props || {});
  e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== ""));
  return e;
};

let codigo = "";
try { codigo = localStorage.getItem("consulta-codigo") || ""; } catch (e) { /* navegador sem armazenamento */ }

function status(texto, tipo) {
  $("status").textContent = texto;
  $("status").className = "status " + (tipo || "");
}

function telas() {
  $("form-codigo").hidden = !!codigo;
  $("form-busca").hidden = !codigo;
  $("atalhos").hidden = !codigo;
  $("sair").hidden = !codigo;
  carregarListas();
  (codigo ? $("q") : $("codigo")).focus();
}

// ------------------------------------------------------------ chamadas

class ErroConsulta extends Error {}

async function pedir(params) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let r;
  try {
    r = await fetch(`${API}?${new URLSearchParams(params)}`, {
      headers: { "x-codigo": codigo }, signal: controle.signal, cache: "no-store", referrerPolicy: "no-referrer",
    });
  } catch (e) {
    throw new ErroConsulta(e.name === "AbortError" ? "a consulta demorou demais" : "sem conexão com a consulta");
  } finally {
    clearTimeout(relogio);
  }
  let d = {};
  try { d = await r.json(); } catch (e) { /* resposta sem corpo */ }
  if (r.status === 401) { sair(); throw new ErroConsulta("código de acesso inválido"); }
  if (!r.ok) throw new ErroConsulta(typeof d.erro === "string" ? d.erro : `erro ${r.status}`);
  return d;
}

// ------------------------------------------------------------ resultado da busca

function nomeGrupo(codigoGrupo, nome) {
  if (!codigoGrupo) return "—";
  return nome ? `${codigoGrupo} - ${nome}` : `${codigoGrupo} (SAP antigo)`;
}

function barras(alvo, itens) {
  if (!itens || !itens.length) { alvo.replaceChildren(el("p", { className: "vazio", textContent: "—" })); return; }
  const max = itens[0].vezes || 1;
  alvo.replaceChildren(...itens.map((g) => {
    const cheio = el("div", { className: "cheio" });
    cheio.style.width = `${Math.max(4, (100 * g.vezes) / max)}%`;
    return el("div", { className: "barra" },
      el("div", {}, el("b", { textContent: nomeGrupo(g.codigo, g.nome) }),
        el("span", { className: "vezes", textContent: ` · ${g.vezes} ${g.vezes === 1 ? "caso" : "casos"}` })),
      el("div", { className: "trilho" }, cheio));
  }));
}

// O selo fala da CLASSIFICACAO daquele caso antigo (tipo e grupos), nao da
// pesquisa: "validada" nao quer dizer "e isto que voce procura".
const SELOS = {
  time: ["selo time", "classificação definida pelo time",
         "Tipo e grupos informados pelo time de Master Data."],
  ok: ["selo ok", "classificação validada",
       "Caso do histórico do Webformat: o time conferiu e confirmou o tipo e os grupos usados nele."],
  nao: ["selo nao", "classificação não validada",
        "Caso do histórico do Webformat, como foi aprovado na época. O time ainda não conferiu se o tipo e os grupos estavam certos."],
};

function selo(x, curto) {
  const [classe, texto, explica] = SELOS[x.origem === "time" ? "time" : x.validado ? "ok" : "nao"];
  return el("span", { className: classe, textContent: curto ? texto.replace("classificação ", "") : texto, title: explica });
}

function parecido(pct, curto) {
  const nivel = pct >= 85 ? "" : pct >= 60 ? " medio" : " baixo";
  return el("span", { className: "parecido" + nivel, title: "Quanto a descrição deste caso se parece com o que você digitou. Não diz se o grupo está certo.",
                      textContent: curto ? `${pct}%` : `${pct}% parecido` });
}

function abrirSolicitacao(n) {
  $("q").value = `situação da ${n}`;
  consultar($("q").value);
}

function numeroLink(n) {
  return el("button", { type: "button", className: "link numero", textContent: String(n),
    title: `Ver a situação da solicitação ${n}`, onclick: () => abrirSolicitacao(n) });
}

// Uma linha da tabela de casos. Reprovada: o tipo pedido e o certo; tipo
// trocado pelo time: "ZMAT -> NLAG".
function linhaCaso(x, porTexto) {
  const td = (...f) => el("td", {}, ...f);
  const pequeno = (t, classe) => el("div", { className: "pequeno " + (classe || ""), textContent: t });
  const trocou = x.tipo_pedido && x.tipo && x.tipo_pedido !== x.tipo;
  const tipo = x.reprovada
    ? td(el("b", { textContent: x.tipo_pedido || "—" }), pequeno(x.tipo ? `reprovada: o certo é ${x.tipo}` : "reprovada", "reprovada"))
    : trocou ? td(el("b", { textContent: x.tipo }), pequeno(`pedido como ${x.tipo_pedido}`))
    : td(el("b", { textContent: x.tipo || "—" }));
  // a observacao de reprovacao/troca ja esta na coluna do tipo
  const obs = x.observacao && !((x.reprovada || trocou) && /reprova|trocou/i.test(x.observacao)) ? x.observacao : "";
  const codigo = x.codigo_definitivo
    ? td(el("span", { className: "codigo-sap", textContent: x.codigo_definitivo }),
      /^\d{10}$/.test(x.codigo_definitivo) ? null : pequeno("SAP antigo"))
    : td(el("span", { className: "pequeno", textContent: "—" }));
  return el("tr", {},
    porTexto ? td(parecido(x.semelhanca, true)) : null,
    el("td", { className: "material" }, el("b", { textContent: x.descricao }),
      el("div", { className: "sob-material" }, x.numero ? el("span", {}, "Solicitação ", numeroLink(x.numero)) : null, selo(x, true)),
      obs ? pequeno(obs) : null),
    tipo,
    td(x.reprovada ? "—" : nomeGrupo(x.gm, x.gm_nome)),
    td(x.reprovada ? "—" : (x.gc ? (x.gc_nome ? `${x.gc} - ${x.gc_nome}` : x.gc) : "—")),
    codigo);
}

// A resposta em uma frase e os dois grupos mais usados, com o peso de cada um.
function respostaPrincipal(d) {
  const gm = (d.grupos_mercadorias || [])[0], gc = (d.grupos_compradores || [])[0];
  const base = (lista) => Math.max(d.encontrados || 0, (lista || []).reduce((t, g) => t + g.vezes, 0)) || 1;
  if (!gm && !gc) {
    return [el("p", { className: "principal-frase", textContent: "Nenhum caso encontrado para esta busca." }),
      el("p", { className: "nota", textContent: "Tente a abreviação usada no Webformat (VALV, TUB, CONEX), o código do grupo (024, EPI) ou um tipo de material (DIEN)." })];
  }
  const frase = d.por_grupo ? `Grupo de mercadorias ${d.grupo}: ${d.encontrados} ${d.encontrados === 1 ? "caso" : "casos"} no histórico.`
    : d.por_tipo ? `Tipo de material ${d.por_tipo}: ${d.encontrados} ${d.encontrados === 1 ? "caso" : "casos"} no histórico.`
    : `Em ${d.encontrados} ${d.encontrados === 1 ? "caso parecido" : "casos parecidos"} com “${d.busca}”, o time usou:`;
  const bloco = (rotulo, g, lista) => {
    if (!g) return null;
    const total = base(lista), pct = Math.round((100 * g.vezes) / total);
    return el("div", { className: "bloco" },
      el("div", { className: "bloco-rotulo", textContent: rotulo }),
      el("div", { className: "bloco-valor", textContent: nomeGrupo(g.codigo, g.nome) }),
      el("div", { className: "bloco-peso", textContent: `em ${g.vezes} de ${total} ${total === 1 ? "caso" : "casos"} (${pct}%)` }));
  };
  const pctGm = gm ? gm.vezes / base(d.grupos_mercadorias) : 1;
  const partes = [el("p", { className: "principal-frase", textContent: frase }),
    el("div", { className: "blocos" },
      d.por_grupo ? null : bloco("Grupo de mercadorias mais usado", gm, d.grupos_mercadorias),
      bloco("Grupo de compradores mais usado", gc, d.grupos_compradores))];
  if (!d.por_grupo && pctGm < 0.6) {
    partes.push(el("p", { className: "aviso", textContent: "Os casos se dividem entre grupos diferentes. Compare as descrições na tabela abaixo antes de escolher." }));
  }
  return partes;
}

function mostrar(d) {
  barras($("gms"), d.grupos_mercadorias);
  barras($("gcs"), d.grupos_compradores);
  const porTexto = !d.por_tipo && !d.por_grupo;
  $("principal").replaceChildren(...respostaPrincipal(d));
  $("titulo-exemplos").textContent = d.por_tipo ? `Últimos casos do tipo ${d.por_tipo} (${d.exemplos.length} de ${d.encontrados})`
    : d.por_grupo ? `Últimos casos do grupo ${d.grupo} (${d.exemplos.length} de ${d.encontrados})`
    : `Casos parecidos (${d.exemplos.length})`;
  const colunas = [porTexto ? "Parecido" : null, "Material", "Tipo", "Grupo de mercadorias", "Grupo de compradores",
    "Código SAP"].filter(Boolean);
  $("cab-casos").replaceChildren(...colunas.map((c) => el("th", { textContent: c })));
  const casos = d.exemplos || [];
  $("exemplos").replaceChildren(...casos.map((x) => linhaCaso(x, porTexto)));
  $("cab-casos").parentElement.parentElement.hidden = !casos.length;
  const filtrado = Object.keys(filtrosAtivos()).length > 0;
  $("sem-casos").hidden = casos.length > 0;
  $("sem-casos").textContent = filtrado ? "Nenhum caso com esses filtros." : "Nenhum caso parecido.";
  $("reprovadas").hidden = !d.reprovados;
  $("reprovadas").textContent = d.reprovados
    ? `E ${d.reprovados} ${d.reprovados === 1 ? "caso parecido foi reprovado" : "casos parecidos foram reprovados"} na triagem.` : "";
  $("resultado").hidden = false;
}

// ------------------------------------------------------------ solicitacoes paradas

function dataHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function mostrarParadas(r) {
  $("titulo-paradas").textContent = r.titulo;
  const mostradas = r.itens.length;
  $("nota-paradas").textContent = (r.total
    ? `${r.total} ${r.total === 1 ? "solicitação" : "solicitações"}, da mais antiga para a mais nova`
      + (r.total > mostradas ? ` (aqui as ${mostradas} mais antigas)` : "") + "."
    : "Nenhuma.") + (r.atualizado_em ? ` Lido do Webformat até ${dataHora(r.atualizado_em)}.` : "");
  $("linhas-paradas").replaceChildren(...r.itens.map((x) => el("tr", {},
    el("td", {}, numeroLink(x.numero)),
    el("td", { textContent: `${x.dias} ${x.dias === 1 ? "dia" : "dias"}`, title: dataHora(x.ultimo_em) }),
    el("td", { textContent: x.com_solicitante ? `solicitante (${x.solicitante || "?"})` : (x.com_quem || "?") }),
    el("td", { textContent: x.situacao }),
    el("td", { textContent: x.cobranca || "", className: /^n[aã]o cobrada/.test(x.cobranca || "") ? "nao-cobrada" : "" }),
    el("td", { textContent: x.descricao || "" }))));
  $("paradas").hidden = false;
}

// ------------------------------------------------------------ solicitacao (leitor do Webformat)

// Paragrafos separados por linha em branco e **negrito**: montados como texto.
function texto(md) {
  return String(md).split(/\n\s*\n/).map((par) => el("p", {}, ...par.split(/\*\*(.+?)\*\*/).map((pedaco, i) =>
    i % 2 ? el("b", { textContent: pedaco }) : document.createTextNode(pedaco))));
}

// A resposta do leitor (o mesmo texto do Teams) vira ficha: cabecalho com a
// situacao, andamento em linha do tempo e os campos em grade.
const CAMPOS_FICHA = ["Descrição longa", "Descrição curta", "Tipo de material", "PDM", "Grupo de mercadorias",
  "Grupo de compradores", "Classe de avaliação", "NCM", "Classe", "Nº de classe", "UAR", "Código definitivo",
  "Dados complementares", "Fabricante", "Referência", "Unidade de medida", "Bem patrimonial", "Urgente",
  "Motivo da urgência"];
const LARGOS = new Set(["Descrição longa", "Tipo de material", "PDM", "Dados complementares", "Motivo da urgência"]);

// "**004 - TUB.CONEX.FERRO** (SAP antigo)" -> negrito no que vem entre **, o resto discreto
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
  if (!cab) return el("div", {}, ...texto(md || `Não foi possível ler a solicitação ${numero} agora.`));
  const campos = [], andamento = [];
  for (const p of pars.slice(1)) {
    const m = p.match(/^([^:*]{2,30}): (.+)$/s);
    if (m && CAMPOS_FICHA.includes(m[1])) campos.push([m[1], m[2]]);
    else andamento.push(p.replace(/\*\*/g, ""));
  }
  const [classe, rotulo] = situacaoDe(andamento);
  const topo = el("div", { className: "ficha-topo" },
    el("div", {},
      el("p", { className: "ficha-numero", textContent: `Solicitação ${cab[1]}` }),
      cab[2] ? el("h3", { className: "ficha-titulo", textContent: cab[2] }) : null),
    andamento.length ? el("span", { className: `ficha-situacao ${classe}`, textContent: rotulo }) : null);
  const partes = [topo];
  if (andamento.length) {
    partes.push(el("ol", { className: "linha-tempo", ariaLabel: "Andamento" },
      ...andamento.map((l) => el("li", { className: /^(Motivo|Antes disso)/.test(l) ? "detalhe" : "", textContent: l }))));
  }
  if (campos.length) {
    partes.push(el("dl", { className: "ficha-campos" }, ...campos.flatMap(([rot, val]) => {
      const codigo = rot === "Código definitivo" && /\d{5,}/.test(val);
      return [el("div", { className: "campo" + (LARGOS.has(rot) ? " largo" : "") + (codigo ? " codigo" : "") },
        el("dt", { textContent: rot }), el("dd", {}, ...valorRico(val)))];
    })));
  }
  return el("div", { className: "ficha" }, ...partes);
}

let espera = 0;
async function acompanhar(d) {
  const minha = ++espera;  // uma consulta nova cancela a espera desta
  status(d.leitor_vivo ? `Lendo a solicitação ${d.numero} no Webformat…`
    : `Leitor do Webformat desligado. A solicitação ${d.numero} ficou na fila e o resultado aparece aqui quando ele voltar (mantenha a página aberta).`,
    "carregando");
  const fim = Date.now() + (d.leitor_vivo ? 3 : 30) * 60 * 1000;
  while (Date.now() < fim && minha === espera) {
    await new Promise((ok) => setTimeout(ok, 1000));
    if (minha !== espera) return;
    let p;
    try { p = await pedir({ pedido: d.pedido }); } catch (e) { continue; }  // falha passageira: tenta de novo
    if (p.status === "respondido" || p.status === "erro") {
      status("");
      $("resposta").replaceChildren(montarFicha(p.resposta, d.numero));
      $("solicitacao").hidden = false;
      return;
    }
  }
  if (minha === espera) status("O Webformat não respondeu a tempo. Tente de novo em alguns minutos.", "erro");
}

// ------------------------------------------------------------ filtros

const FILTROS = { tipo: "f-tipo", origem: "f-origem", gc: "f-gc" };

function filtrosAtivos() {
  const f = {};
  for (const [nome, id] of Object.entries(FILTROS)) if ($(id).value) f[nome] = $(id).value;
  return f;
}

function marcarFiltros() {
  for (const id of Object.values(FILTROS)) $(id).classList.toggle("ativo", !!$(id).value);
  const n = Object.keys(filtrosAtivos()).length;
  $("limpar-filtros").hidden = !n;
  $("abrir-filtros").textContent = n ? `Filtrar (${n})` : "Filtrar";
  $("abrir-filtros").classList.toggle("ativo", n > 0);
}

$("abrir-filtros").addEventListener("click", () => {
  const abrir = $("filtros").hidden;
  $("filtros").hidden = !abrir;
  $("abrir-filtros").setAttribute("aria-expanded", abrir ? "true" : "false");
});

let listasCarregadas = false;
async function carregarListas() {
  if (listasCarregadas || !codigo) return;
  try {
    const d = await pedir({ listas: 1 });
    $("f-tipo").append(...d.tipos.map((t) => el("option", { value: t, textContent: t })));
    $("f-gc").append(...d.grupos_compradores.map((g) =>
      el("option", { value: g.codigo, textContent: `${g.codigo} - ${g.descricao}` })));
    listasCarregadas = true;
  } catch (e) { /* sem as listas, os filtros ficam so com "Todos" */ }
}

let ultima = "";
$("filtros").addEventListener("change", () => {
  marcarFiltros();
  if (ultima) consultar(ultima);
});
$("limpar-filtros").addEventListener("click", () => {
  for (const id of Object.values(FILTROS)) $(id).value = "";
  marcarFiltros();
  if (ultima) consultar(ultima);
});

// ------------------------------------------------------------ fluxo

async function consultar(q) {
  ultima = q;
  espera++;
  $("resultado").hidden = true;
  $("solicitacao").hidden = true;
  $("paradas").hidden = true;
  $("botao").disabled = true;
  status("Consultando…", "carregando");
  try {
    const d = await pedir({ q, ...filtrosAtivos() });
    if (d.pedido) await acompanhar(d);
    else if (d.paradas) { status(""); mostrarParadas(d.paradas); }
    else { status(""); mostrar(d); }
  } catch (e) {
    status("Falha na consulta: " + (e instanceof ErroConsulta ? e.message : "erro inesperado"), "erro");
  } finally {
    $("botao").disabled = false;
  }
}

function sair() {
  codigo = "";
  try { localStorage.removeItem("consulta-codigo"); } catch (e) { /* ok */ }
  espera++;
  $("resultado").hidden = true;
  $("solicitacao").hidden = true;
  status("");
  telas();
}

$("form-codigo").addEventListener("submit", (ev) => {
  ev.preventDefault();
  codigo = $("codigo").value.trim();
  $("codigo").value = "";
  if (!codigo) return;
  try { localStorage.setItem("consulta-codigo", codigo); } catch (e) { /* ok */ }
  telas();
  status("Código salvo neste navegador.");
});

$("form-busca").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const q = $("q").value.trim();
  if (q.length >= 2) consultar(q);
});

// Os tres jeitos de usar a consulta: cada um troca o exemplo da caixa e os
// atalhos. A funcao entende qualquer um pelo texto; o modo so orienta.
const MODOS = {
  material: { dica: "Descreva o material, ou digite um grupo (024, EPI) ou um tipo de material (DIEN)",
              exemplos: ["válvula gaveta", "luva de raspa", "EPI", "DIEN"] },
  solicitacao: { dica: "Número da solicitação, ex.: 3951 (ou: GM da 3291, código SAP da 3231)",
                 exemplos: ["situação da 3951", "GM da 3291", "código SAP da 3231"] },
  paradas: { dica: "Ex.: paradas com a CH há mais de 5 dias",
             exemplos: ["paradas com a CH há mais de 5 dias", "pendências há mais de 15 dias",
                        "paradas com o solicitante e não cobradas"] },
};

function escolherModo(nome) {
  const m = MODOS[nome] || MODOS.material;
  for (const b of document.querySelectorAll(".modo")) b.setAttribute("aria-pressed", b.dataset.modo === nome ? "true" : "false");
  $("q").placeholder = m.dica;
  $("exemplos-modo").replaceChildren(...m.exemplos.map((q) => el("button", { type: "button", textContent: q })));
  for (const [i, b] of [...$("exemplos-modo").children].entries()) b.dataset.q = m.exemplos[i];
}

$("atalhos").addEventListener("click", (ev) => {
  const modo = ev.target.closest("button[data-modo]")?.dataset.modo;
  if (modo) { escolherModo(modo); $("q").focus(); return; }
  const q = ev.target.closest("button[data-q]")?.dataset.q;
  if (q) { $("q").value = q; consultar(q); }
});
escolherModo("material");

$("sair").addEventListener("click", sair);
telas();

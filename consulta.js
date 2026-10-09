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
  $("filtros").hidden = !codigo;
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
         "O time respondeu à Bella qual era o tipo e os grupos certos para este material."],
  ok: ["selo ok", "classificação validada",
       "Caso do histórico do Webformat: o time conferiu e confirmou o tipo e os grupos usados nele."],
  nao: ["selo nao", "classificação não validada",
        "Caso do histórico do Webformat, como foi aprovado na época. O time ainda não conferiu se o tipo e os grupos estavam certos."],
};

function selo(x) {
  const [classe, texto, explica] = SELOS[x.origem === "time" ? "time" : x.validado ? "ok" : "nao"];
  return el("span", { className: classe, textContent: texto, title: explica });
}

function parecido(pct) {
  const nivel = pct >= 85 ? "" : pct >= 60 ? " medio" : " baixo";
  return el("span", { className: "parecido" + nivel, title: "Quanto a descrição deste caso se parece com o que você digitou. Não diz se o grupo está certo.",
                      textContent: `${pct}% parecido` });
}

function exemplo(x, porTexto) {
  const meta = el("div", { className: "meta" });
  const b = (t) => el("b", { textContent: t });
  if (x.reprovada) {
    // tipo_pedido = como foi aberta no Webformat; tipo = o certo, apontado na triagem
    if (x.tipo_pedido) meta.append("Pedido como ", b(x.tipo_pedido), " · ");
    meta.append(el("span", { className: "reprovada",
      textContent: x.tipo ? `reprovada na triagem: o certo é ${x.tipo}` : "reprovada na triagem" }));
  } else {
    if (x.tipo_pedido && x.tipo && x.tipo_pedido !== x.tipo) {
      meta.append("Pedido como ", b(x.tipo_pedido), " · o time trocou para ", b(x.tipo), " · ");
    } else if (x.tipo) {
      meta.append("Tipo ", b(x.tipo), " · ");
    }
    meta.append("GM ", b(nomeGrupo(x.gm, x.gm_nome)),
                " · GC ", b(x.gc ? (x.gc_nome ? `${x.gc} - ${x.gc_nome}` : x.gc) : "—"));
  }
  if (x.codigo_definitivo) {
    meta.append(" · Código ", el("b", { textContent: x.codigo_definitivo }),
                /^\d{10}$/.test(x.codigo_definitivo) ? "" : " (SAP antigo)");
  }
  if (x.numero) meta.append(` · solicitação ${x.numero}`);
  return el("div", { className: "exemplo" },
    el("div", { className: "desc" }, x.descricao, porTexto ? parecido(x.semelhanca) : null, selo(x)), meta,
    // a observacao de reprovacao ja virou a linha acima
    x.observacao && !((x.reprovada || (x.tipo_pedido && x.tipo_pedido !== x.tipo)) && /reprova/i.test(x.observacao))
      ? el("div", { className: "obs", textContent: x.observacao }) : null);
}

function mostrar(d) {
  barras($("gms"), d.grupos_mercadorias);
  barras($("gcs"), d.grupos_compradores);
  const porTexto = !d.por_tipo && !d.por_grupo;
  $("titulo-exemplos").textContent = d.por_tipo
    ? `Últimos casos do tipo ${d.por_tipo} (${d.exemplos.length} de ${d.encontrados})`
    : d.por_grupo ? `Últimos casos do grupo ${d.grupo} (${d.exemplos.length} de ${d.encontrados})`
    : `Casos parecidos (${d.encontrados})`;
  $("reprovadas").hidden = !d.reprovados;
  $("reprovadas").textContent = d.reprovados
    ? `E ${d.reprovados} ${d.reprovados === 1 ? "caso parecido foi reprovado" : "casos parecidos foram reprovados"} na triagem.` : "";
  const filtrado = Object.keys(filtrosAtivos()).length > 0;
  $("exemplos").replaceChildren(...(d.exemplos && d.exemplos.length ? d.exemplos.map((x) => exemplo(x, porTexto))
    : [el("p", { className: "vazio", textContent: filtrado
        ? "Nenhum caso com esses filtros. Experimente limpar os filtros."
        : "Nenhum caso parecido. Tente outra palavra, a abreviação do Webformat (VALV, TUB, CONEX) ou um grupo (024, EPI)." })]));
  $("resultado").hidden = false;
}

// ------------------------------------------------------------ solicitacao (leitor do Webformat)

// Paragrafos separados por linha em branco e **negrito**: montados como texto.
function texto(md) {
  return String(md).split(/\n\s*\n/).map((par) => el("p", {}, ...par.split(/\*\*(.+?)\*\*/).map((pedaco, i) =>
    i % 2 ? el("b", { textContent: pedaco }) : document.createTextNode(pedaco))));
}

let espera = 0;
async function acompanhar(d) {
  const minha = ++espera;  // uma consulta nova cancela a espera desta
  status(d.leitor_vivo ? `Olhando a solicitação ${d.numero} no Webformat…`
    : `O leitor do Webformat está desligado agora. A pergunta sobre a ${d.numero} ficou na fila; deixe esta página aberta.`,
    "carregando");
  const fim = Date.now() + (d.leitor_vivo ? 3 : 30) * 60 * 1000;
  while (Date.now() < fim && minha === espera) {
    await new Promise((ok) => setTimeout(ok, 1000));
    if (minha !== espera) return;
    let p;
    try { p = await pedir({ pedido: d.pedido }); } catch (e) { continue; }  // falha passageira: tenta de novo
    if (p.status === "respondido" || p.status === "erro") {
      status("");
      $("resposta").replaceChildren(...texto(p.resposta || `Não consegui ler a solicitação ${d.numero} agora.`));
      $("solicitacao").hidden = false;
      return;
    }
  }
  if (minha === espera) status("O Webformat não respondeu a tempo. Tente de novo daqui a pouco.", "erro");
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
  $("limpar-filtros").hidden = !Object.keys(filtrosAtivos()).length;
}

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
  $("botao").disabled = true;
  status("Consultando…", "carregando");
  try {
    const d = await pedir({ q, ...filtrosAtivos() });
    if (d.pedido) await acompanhar(d);
    else { status(""); mostrar(d); }
  } catch (e) {
    status("Não consegui consultar: " + (e instanceof ErroConsulta ? e.message : "erro inesperado"), "erro");
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
  status("Código guardado neste navegador. Agora digite um material ou uma solicitação.");
});

$("form-busca").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const q = $("q").value.trim();
  if (q.length >= 2) consultar(q);
});

$("atalhos").addEventListener("click", (ev) => {
  const q = ev.target.closest("button[data-q]")?.dataset.q;
  if (q) { $("q").value = q; consultar(q); }
});

$("sair").addEventListener("click", sair);
telas();

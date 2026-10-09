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

function selo(x) {
  if (x.origem === "time") return el("span", { className: "selo time", textContent: "resposta do time" });
  return x.validado ? el("span", { className: "selo ok", textContent: "validado" })
                    : el("span", { className: "selo nao", textContent: "não validado" });
}

function exemplo(x) {
  const meta = el("div", { className: "meta" });
  if (x.tipo) meta.append("Tipo ", el("b", { textContent: x.tipo }), " · ");
  meta.append("GM ", el("b", { textContent: nomeGrupo(x.gm, x.gm_nome) }),
              " · GC ", el("b", { textContent: x.gc ? (x.gc_nome ? `${x.gc} - ${x.gc_nome}` : x.gc) : "—" }));
  if (x.codigo_definitivo) {
    meta.append(" · Código ", el("b", { textContent: x.codigo_definitivo }),
                /^\d{10}$/.test(x.codigo_definitivo) ? "" : " (SAP antigo)");
  }
  if (x.numero) meta.append(` · solicitação ${x.numero}`);
  if (x.semelhanca && x.semelhanca < 100) meta.append(` · ${x.semelhanca}% parecido`);
  return el("div", { className: "exemplo" },
    el("div", { className: "desc" }, x.descricao, selo(x)), meta,
    x.observacao ? el("div", { className: "obs", textContent: x.observacao }) : null);
}

function mostrar(d) {
  barras($("gms"), d.grupos_mercadorias);
  barras($("gcs"), d.grupos_compradores);
  $("titulo-exemplos").textContent = d.por_tipo
    ? `Últimos casos do tipo ${d.por_tipo} (${d.exemplos.length} de ${d.encontrados})`
    : d.por_grupo ? `Últimos casos do grupo (${d.exemplos.length})` : `Casos parecidos (${d.encontrados})`;
  $("reprovadas").hidden = !d.reprovados;
  $("reprovadas").textContent = d.reprovados
    ? `E ${d.reprovados} ${d.reprovados === 1 ? "caso parecido foi reprovado" : "casos parecidos foram reprovados"} na triagem.` : "";
  $("exemplos").replaceChildren(...(d.exemplos && d.exemplos.length ? d.exemplos.map(exemplo)
    : [el("p", { className: "vazio", textContent: "Nenhum caso parecido. Tente outra palavra, a abreviação do Webformat (VALV, TUB, CONEX) ou um código de grupo." })]));
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

// ------------------------------------------------------------ fluxo

async function consultar(q) {
  espera++;
  $("resultado").hidden = true;
  $("solicitacao").hidden = true;
  $("botao").disabled = true;
  status("Consultando…", "carregando");
  try {
    const d = await pedir({ q });
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

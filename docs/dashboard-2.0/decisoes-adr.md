# Decisões de arquitetura (ADRs) | Dashboard 2.0

> Uma decisão por bloco, numerada, imutável depois de aceita (mudou de ideia = novo
> ADR que supersede o antigo, nunca editar o histórico). Formato: contexto → decisão
> → alternativas descartadas → consequências.
>
> Status possíveis: **Aceita** · **Proposta** (aguarda aprovação do dono) ·
> **Substituída por ADR-XXX**.

---

## ADR-001 | O 2.0 nasce dentro do repo 1.0, por estrangulamento, com gates de paridade

**Status:** Aceita (2026-07-14)

**Contexto:** o doc de planejamento descreve o destino (arquitetura em camadas), e a
seção 11.1 aponta que faltava a travessia. Reescrever do zero criaria dois projetos
meia-boca; o 1.0 tem motor de receita validado, snapshots, i18n e drawers já pagos.

**Decisão:** o 2.0 é construído **dentro deste repo**, por extração e promoção do
que existe (*strangler fig*). Nenhum painel funcionando é reescrito; camadas novas
nascem por baixo (catálogo → consumo → geração) e cada religação de consumo só
fecha com **gate de paridade** (números idênticos antes/depois, provados pelo
harness: `scripts/_capture-charts.js`, `scripts/test-delta-invariant.js`,
`action=compare` e as fotos semanais).

**Alternativas descartadas:** (a) repo novo + migração big-bang — viola "não perder
nada" e duplica manutenção; (b) ferramenta de BI pronta — ver ADR-002.

**Consequências:** convivência longa entre padrões velho e novo é aceita e
administrada (cada fase é terminal: parar em qualquer uma deixa o projeto melhor,
não pela metade). Rollback de qualquer fase = revert de commits aditivos.

---

## ADR-002 | Build, não buy (registro do checkpoint da Fase 0)

**Status:** Aceita (2026-07-14)

**Contexto:** checkpoint obrigatório do doc de planejamento (§4.4 e §11.5), incluindo
a opção híbrida com metrics layer pronto (dbt/Cube/Evidence).

**Decisão:** continuar custom neste repo. Racional completo e **gatilhos de revisão**
registrados no [charter.md §4](charter.md).

**Consequências:** a camada semântica (catálogo) é construída por nós na Fase 1 —
ela é a peça que um metrics layer daria pronto, e é onde mora o custo assumido.

---

## ADR-003 | Catálogo em JSON, com visualização legível gerada

**Status:** Aceita (2026-07-14)

**Contexto:** os 3 arquivos base precisam ser máquina-legíveis e editáveis pelo dono
(não-programador). YAML é mais legível a olho nu, mas o stack é "zero dependência
npm" e o front é ES5 — YAML exigiria parser externo; JSON o Node e o browser leem
nativamente.

**Decisão:** `semantic/dados.json`, `semantic/regras.json`,
`semantic/referencia.json` em **JSON**, com duas mitigações de legibilidade:
(1) `scripts/check-semantic.js` valida sintaxe e consistência a cada `npm run check`
(erro de vírgula não passa despercebido); (2) um gerador produz visualização legível
(markdown/HTML) do catálogo para leitura e revisão humana.

**Alternativas descartadas:** YAML (dependência nova); prosa em markdown (é o estado
atual — IA relê e reconcilia a cada sessão, caro e ambíguo).

**Consequências:** edições do dono passam por pedido à IA ou edição direta com o
check como rede de segurança.

---

## ADR-004 | Dado manual: definição no catálogo, valor no KV, sempre com selo e rastro

**Status:** Aceita (2026-07-14) — consolida §4.1/§4.5 do doc de planejamento

**Contexto:** dado manual envelhece calado, se disfarça de dado duro, some no deploy
e não tem rastro. O KV (Upstash) já guarda o faturamento manual, mas sem metadados.

**Decisão:** a *definição* de todo dado manual (nome PT/EN, unidade, dono, validade)
mora em `dados.json` com `origem: manual`; o *valor* mora no KV com
`atualizado_em`, `atualizado_por` e valor anterior (log mínimo). Na UI, todo número
que carrega dado manual exibe selo "✏️ inserido manualmente" e badge de
envelhecimento após a validade declarada. Precedência manual×calculado é declarada
na regra (`regras.json`), nunca implícita no código.

**Consequências:** o faturamento manual existente ganha metadados retroativos na
Fase 4 (valores atuais preservados; histórico começa a contar dali).

---

## ADR-005 | Bilíngue por design: rótulo mora no catálogo

**Status:** Aceita (2026-07-14) — consolida §4.2

**Decisão:** todo texto de interface passa por `t()`; rótulo e ajuda de métrica
moram no catálogo já bilíngues (`label: { pt, en }`). Formatação localiza
(datas, milhar), **moeda continua BRL** nos dois idiomas. Nomes de etapa do CRM
ficam em PT (nomes próprios), regra herdada do 1.0.

**Consequências:** a Fase 1 já nasce com labels PT/EN; os dicionários duplicados por
HTML do 1.0 convergem para o catálogo gradualmente (sem retrofit big-bang).

---

## ADR-006 | Drawer de proveniência gerado do catálogo (contrato dos 11 campos)

**Status:** Aceita (2026-07-14) — consolida §4.7

**Decisão:** o drawer de info nunca é escrito à mão. Ele projeta automaticamente,
dos 3 arquivos base: o que é | origem/tipo | campos HubSpot | colunas do modal |
etapas incluídas E excluídas | filtro temporal (nomeando a propriedade-alvo) |
outros filtros (incluindo os que o gráfico ignora) | unidade+granularidade |
dedup | última atualização | status de validação — mais os condicionais (fórmula,
ponderação, precedência, faltantes, selo manual, link de reprodução no HubSpot).

**Consequências:** `NOVO_HELP_CHARTS` (texto à mão do 1.0) é aposentado painel a
painel, começando pelo golden template (Fase 3, `/forecast`). Um gráfico só ganha
drawer gerado quando suas métricas entram no catálogo — o que força o catálogo a
crescer puxado por uso real, não por inventário especulativo.

---

## ADR-007 | Etapas "ativas" são configuráveis pelo usuário

**Status:** Aceita como requisito (2026-07-14); implementação na Fase 4

**Contexto:** requisito do dono registrado no doc de planejamento: o usuário precisa
escolher quais etapas contam como pipeline ativo — especialmente **Reunião** e
**Standby**, cuja inclusão muda leituras de pipeline e forecast.

**Decisão:** `referencia.json` declara, por etapa, o default de "ativa"; a config
global (settings) permite o usuário sobrepor. Engines e painéis que consomem
"deals ativos" leem essa definição única — nenhum painel hardcodeia a lista.
O drawer de cada gráfico afetado mostra as etapas efetivamente consideradas
(campo 5 do contrato ADR-006), então a escolha do usuário fica sempre visível.

---

## ADR-008 | Probabilidade de etapa: toggle global forçada × calculada

**Status:** Aceita como requisito (2026-07-14); implementação na Fase 4

**Contexto:** requisito do dono. Existem duas fontes de probabilidade: as
**premissas** (régua forçada, ex.: a flat do Forecast) e a **calculada em tempo
real** pelo funil (C06/C07). Hoje a escolha é implícita por painel — já causou
divergência real (fix de 2026-07-14 no `/forecast`).

**Decisão:** um toggle nas **configurações globais** escolhe a fonte de
probabilidade (forçada × calculada). As duas réguas moram em `referencia.json`
(a forçada como valores; a calculada como referência à regra que a computa).
Todo consumidor de probabilidade lê da fonte selecionada; o drawer declara qual
fonte está em uso (campo condicional "ponderação" do ADR-006).

**Consequências:** elimina a classe de bug "painel X usa régua A, painel Y usa
régua B". Overrides locais legados (`forecast_stage_prob`) são migrados/limpos.

---

## ADR-009 | Deploy via integração GitHub↔Vercel com previews por branch

**Status:** Aceita (2026-07-14); execução agendada para logo após o fechamento da Fase 1

**Contexto:** `vercel --prod` da máquina sobe o working tree de quem digitou; o
takeover de alias entre sessões já ocorreu 2× (documentado no STATUS_LOG). A seção
11.1 do doc de planejamento e o item 3 do §11.6 pedem push no `main` = deploy
automático + URL de preview por branch.

**Decisão (proposta):** ativar a integração nativa GitHub↔Vercel no projeto Pro
`dashboard-axenya`: `main` protegido, deploy de produção só por merge, previews por
branch para cada sessão validar a sua sem pisar em ninguém. `DEPLOY_GUIDE.md`,
`docs/github-source-of-truth.md` e o protocolo `/axenya-deploy` são atualizados no
mesmo PR.

**Timing decidido:** logo após o fechamento da Fase 1, por ser mudança de processo
independente das mudanças de código.

---

## ADR-010 | Regras com vigência temporal (`vigente_desde`)

**Status:** Aceita (2026-07-14) — consolida §11.2

**Contexto:** sem vigência, toda mudança de fórmula reescreve o passado em silêncio
e quebra a promessa "reproduzir o que dissemos ao board" (dilema já registrado na
spec do Delta: recompute usa as regras de hoje).

**Decisão:** toda regra em `regras.json` carrega `vigente_desde` (e opcionalmente
`vigente_ate`). Recomputes ponto-no-tempo (Delta, fotos) usam a regra vigente na
data da foto. A primeira versão de cada regra extraída do 1.0 nasce com
`vigente_desde` = data da extração, e o comportamento atual (recompute com regra
corrente) permanece até os consumidores adotarem vigência — mudança de
comportamento só com gate de paridade.

---

## ADR-011 | Fuso horário fixado: America/Sao_Paulo, convertido uma vez na ingestão

**Status:** Aceita (2026-07-14) — consolida §11.2

**Contexto:** HubSpot grava UTC; deal fechado 30/06 22h de SP é 01/07 UTC → muda o
mês da receita. Já doeu ("foto de junho" capturada em 02/07).

**Decisão:** todo corte temporal (mês/semana/dia) se calcula em
`America/Sao_Paulo`, convertido **uma única vez** na camada de ingestão/regras —
nunca em cada gráfico. A Fase 1 registra em `regras.json` qual propriedade e qual
fuso cada corte usa; a Fase 2+ audita os pontos do código onde o corte é feito hoje
e converge, com gate de paridade (divergências encontradas são bugs a listar, não a
esconder).

# Dashboard 2.0 — Planejamento de Arquitetura

> **Documento vivo.** Registro do raciocínio e das decisões de como construir, do
> zero, o dashboard principal da Axenya: a fonte única de conhecimento da empresa
> (Marketing, Sales, CS, Implantação, etc.).
>
> **Para quem é:** o dono do projeto (não-programador) que dirige a IA, e qualquer
> pessoa futura que for iterar. Se você chegou agora, leia as seções 1, 2 e 3 antes
> de pedir qualquer coisa à IA.
>
> **Requisitos de topo (inegociáveis):**
> 1. Bilíngue (PT/EN) desde a fundação.
> 2. Alguns dados são **calculados**, outros **inseridos/inferidos manualmente** — e
>    a diferença precisa ser explícita e auditável.
> 3. Projeto **vivo**: fácil de incrementar e iterar, sem quebrar o que existe.
> 4. **Multi-pessoa**: outras pessoas (e outras IAs) vão iterar. Onboarding barato.
> 5. **Digno de programador, feito por não-programador.**

---

# 1. Como operar sem ser programador

Pensar "como programador" **não é aprender a escrever código**. É adotar hábitos
mentais que domam complexidade. No seu caso a IA programa; **seu** papel é ser o
*arquiteto/PM* que entrega especificações limpas e valida o resultado. Otimizar
tempo e tokens = ser um bom cliente da IA.

## 1.1 Os 6 hábitos (traduzidos pra você)

1. **Decomposição.** Nunca peça "constrói o dashboard". Quebre até um pedaço pequeno
   e independente: "constrói só o gráfico de receita probabilizada do painel Sales".
   Pedido pequeno = a IA erra pouco, gasta pouco token, você valida rápido. Big bang é
   o que quebra e queima dinheiro.
2. **Uma verdade, um lugar (SSOT).** Toda informação repetida cria um lugar pra ficar
   desatualizada. Cada fato (fórmula de receita, cor da marca, nome de um AE) mora em
   **um** arquivo só.
3. **Contrato/interface.** Defina a *fronteira* entre pedaços e ignore o miolo. "O
   gráfico recebe um `metric_id` e devolve uma barra" — você não precisa saber COMO
   ele desenha. Isso te liberta de entender código: você opera nos encaixes.
4. **Declarativo, não imperativo.** Descreva **o quê** quer (o resultado), nunca
   **como** fazer. Você nunca deveria dizer à IA qual linha mudar.
5. **Incremental + validar cada passo.** Um pedaço → testar → funcionou? → commit
   (ponto de restauração) → próximo. Nunca acumule mudanças não-validadas.
6. **Reprodutível.** Mesma entrada → mesma saída, sempre. É por isso que "foto datada"
   (snapshot) importa: sem ela você não confere se algo quebrou.

## 1.2 Seu papel vs. o papel da IA

| Você faz (arquiteto/PM) | IA faz (builder) |
|---|---|
| Decide o que o painel responde | Escreve o código |
| Mantém os docs canônicos atualizados | Lê os docs pra ter contexto |
| Escreve o pedido com **critério de aceite** | Implementa até passar no critério |
| Valida por **comportamento** (número bate? abre?) | Se auto-verifica no harness (3002) |
| Aprova commit/deploy | Executa |

## 1.3 O truque que mais economiza token: critério de aceite

- ❌ "Faz um gráfico de receita." → 5 idas e vindas.
- ✅ "Gráfico de barras, receita probabilizada por mês, 12 meses, toggle
  Real/Probabilizado, cores da marca, e o número de julho tem que bater com o painel
  Forecast." → a IA acerta de primeira e se auto-valida.

Um spec bom é o que separa 1 tentativa de 10. **Você virou o spec.**

---

# 2. Princípios críticos (o porquê e o risco de violar)

Cada princípio vem com a **dor real** que ele evita. São o "código de leis" do projeto.

| Princípio | Por que existe | Risco se violar |
|---|---|---|
| **SSOT — uma verdade, um lugar** | Evita números divergentes entre painéis | Dois painéis mostram receita diferente; ninguém confia no dash |
| **Painel não calcula, só projeta** | O cálculo mora na camada semântica | Cada painel vira uma calculadora paralela que diverge |
| **Contrato aditivo** | Adicionar é seguro; renomear/remover quebra tudo | Um rename derruba os 10 painéis de uma vez |
| **Calculado ≠ Manual, sempre explícito** | Decisão de negócio precisa saber o que é chute | Uma premissa manual se disfarça de dado duro e engana o BoD |
| **Bilíngue por design, nunca hardcoded** | PT/EN desde a fundação | Retrofit de idioma depois = reescrever todo texto do dash |
| **Proveniência em tudo** | Auditar de onde vem cada número | "Esse número tá certo?" sem resposta rastreável |
| **Persistência fora do código** | Dado manual sobrevive a deploy | Deploy apaga tudo (a armadilha do /tmp efêmero) |
| **Validar por comportamento** | Você não lê código, lê resultado | Aprova algo que "parece certo" mas mente |

---

# 3. Arquitetura em camadas (de dentro pra fora)

A "fonte de conhecimento da empresa" **não são os painéis** — é a camada 2. O painel é
só uma projeção. Acertando a camada 2, os painéis viram recombináveis e descartáveis.

```
6. Idioma/i18n    (dicionário PT/EN — atravessa todas as camadas visuais)
5. Painéis        (compõem via manifesto, NÃO calculam)
4. Componentes    (gráficos reutilizáveis, parametrizados por metric_id)
3. Design system  (tokens visuais globais: cor, fonte, espaçamento)
2. Camada semântica ← O CORAÇÃO. 3 arquivos: Dados + Regras + Referência (ver 4.5).
1. Ingestão/snapshot (dados versionados, fotos datadas, auditáveis)
0. Fontes         (HubSpot, Google, planilhas, entrada manual)
```

**Por que de dentro pra fora:** cada camada só depende da anterior. Você pode trocar
todo o visual (camadas 3–5) sem tocar na verdade (camada 2). E pode adicionar uma
métrica (camada 2) e ela nasce disponível pra qualquer painel.

---

# 4. Decisões críticas de design (os pontos difíceis)

Aqui mora o pensamento crítico. Os pontos difíceis, cada um com seu trade-off.

## 4.1 Dados calculados vs. manuais vs. inferidos

Este é o ponto mais perigoso do projeto. Três tipos de dado convivem:

| Tipo | O que é | Exemplo | Comportamento |
|---|---|---|---|
| **Bruto (raw)** | Vem direto da fonte | valor do deal no HubSpot | Atualiza sozinho |
| **Calculado (derived)** | Fórmula sobre bruto | taxa de conversão = ganhos ÷ total | Atualiza sozinho, reproduzível |
| **Manual / inferido** | Digitado por humano | meta trimestral, faturamento manual, premissa de ramp-up | **Não** atualiza sozinho |
| **Híbrido** | Calculado com override manual | previsão probabilizada que o faturamento manual sobrepõe | Manual vence, e isso fica registrado |

**Riscos do dado manual (e a defesa de cada um):**

1. **Envelhece calado.** Número digitado em janeiro ainda aparece em julho.
   → Todo dado manual carrega `atualizado_em` + `atualizado_por` e **avisa quando fica
   velho** (badge amarelo após N dias).
2. **Se disfarça de dado duro.** Um chute mostrado igual a um fato engana decisão.
   → Dado manual sempre tem **selo visual** ("✏️ inserido manualmente") e aparece na
   proveniência do gráfico.
3. **Some no deploy.** Se mora no código, o próximo deploy apaga.
   → Persistência **fora do código** (banco tipo Upstash/KV). Nunca no HTML.
4. **Sem rastro.** Quem mudou? Quando?
   → Log de alteração (mínimo: valor anterior, novo, quem, quando).
5. **Precedência ambígua.** Quando há calculado E manual, qual vence?
   → A regra de precedência é **declarada na métrica**, não implícita no código.

**Decisão de arquitetura:** o catálogo (camada 2) declara em cada métrica um campo
`tipo: raw | calculado | manual | hibrido`. Métricas manuais/híbridas ganham
automaticamente: tela de edição, persistência, timestamp, selo e alerta de validade.
Isso não é opcional — é o que impede o dash de mentir.

## 4.2 Bilíngue (PT/EN) por design

**Erro clássico:** escrever tudo em português e "traduzir depois". Retrofit de idioma
é reescrever o dash inteiro. Bilíngue nasce na fundação ou não nasce.

Regras:
- **Nenhum texto visível é escrito direto no painel.** Todo texto tem uma chave e o
  valor vem de um dicionário `{ pt, en }`. Ex.: em vez de escrever "Receita", o painel
  pede `t('receita.label')`.
- **O rótulo da métrica mora no catálogo**, já bilíngue: `label: { pt: "...", en: "..." }`.
  Assim tradução e definição vivem no mesmo lugar (SSOT).
- **Idioma é config global** (um toggle, preferência salva por usuário).
- **Nunca montar frase juntando pedaços traduzidos** (a gramática muda entre idiomas).
  Use a frase inteira como template.
- **Formatação também localiza:** data e separador de milhar mudam (`1.000,00` PT vs
  `1,000.00` EN). *Cuidado crítico:* a **moeda continua BRL** — só a formatação muda,
  não o valor. Não "traduza" R$ para US$.
- **Risco multi-pessoa:** alguém novo crava um texto em português e quebra o EN.
  → Convenção obrigatória (todo texto passa por `t()`) + um check que sinaliza texto
  hardcoded.

## 4.3 Projeto vivo: incrementar e iterar sem quebrar

O que faz um projeto ser fácil de evoluir:

- **Contrato aditivo.** Adicionar métrica = adicionar linha no catálogo. Adicionar
  painel = adicionar um manifesto. **Nada disso mexe no que já existe.** Renomear ou
  remover é o único movimento perigoso e exige migração consciente.
- **Ciclo de vida da métrica:** `rascunho → em revisão → validado → descontinuado`.
  Nada nasce "validado". Isso deixa o inacabado conviver com o confiável sem confundir.
- **Feature flag** para painel em construção: fica escondido até virar `validado`.
- **Versionar o catálogo e o contrato de dados** (um número de versão simples). Quando
  o formato mudar, dá pra saber quem precisa se atualizar.

## 4.4 Multi-pessoa: outros vão iterar

- **Os docs canônicos SÃO o onboarding.** Este arquivo + o catálogo + o guia de
  convenções. Pessoa nova (ou IA nova) começa lendo eles, não o código.
- **Definição de Pronto (DoD)** por mudança: validado no harness + doc atualizado +
  commitado. Sem os três, não está pronto.
- **Declarar território** antes de mexer (evita duas pessoas no mesmo arquivo). Regra
  que já existe no projeto atual.
- **O catálogo máquina-legível é o contrato compartilhado** que deixa gente trabalhar
  em paralelo sem se atropelar: cada um fala "métrica X", não "linha 4302 do HTML".

> **Pensamento crítico honesto (checkpoint de Fase 0):** antes de construir do zero,
> pergunte "deveríamos construir isto?". Ferramentas prontas (Metabase, Looker, Power
> BI) entregam BI, i18n e auditoria de graça. Construir custom só se justifica pelo
> controle visual/UX específico e pela integração fina que essas ferramentas não dão.
> Registre a resposta — é a decisão mais cara do projeto.

## 4.5 Organização dos arquivos base (dados / regras / referência)

A camada semântica (camada 2) não é um arquivo só — são **três papéis distintos**,
separando *fatos/entradas* de *derivações*. É um padrão real de engenharia (base vs.
derivado vs. dimensão).

| Arquivo | Papel | O que contém | Você mexe? |
|---|---|---|---|
| **1. Dados** (base) | Fatos e entradas | Registro de cada dado que o dash usa | Sim — é aqui que você **adiciona** um dado novo |
| **2. Regras** | Derivações | Toda fórmula e cálculo | Ao criar/mudar um cálculo |
| **3. Referência** | Dimensões estáveis | Pipes, etapas, códigos, probabilidades | Raramente (só quando muda o funil) |

**Sutileza do Arquivo 1 (a mais importante do projeto):** dentro da base convivem dois
tipos de dado que se comportam de forma oposta. Marque cada item com `origem`:
- `origem: fonte` — vem do HubSpot, você **não digita**, atualiza sozinho. Aqui você só
  **registra que existe** (nome, unidade, de onde vem).
- `origem: manual` — meta, faturamento manual, premissa: você **digita**. Ganha
  automaticamente selo visual, timestamp e persistência.

> ⚠️ **Definição mora no arquivo; valor mora no banco.** No Arquivo 1 fica a
> *definição* do dado manual ("meta trimestral, R$, dono = CRO"). O *valor* em si
> (R$ 2M) mora no banco (Upstash/KV), nunca no arquivo — senão o deploy apaga e você
> perde o rastro de quem mudou o quê.

**A regra que faz tudo funcionar: a seta única de dependência.** Os arquivos só se
referenciam numa direção, nunca ao contrário:

```
   Gráfico  ──►  2. Regras  ──►  1. Dados
                            └──►  3. Referência (pipe/etapas)
```

- Gráfico pergunta às **regras**, nunca pega dado cru pra calcular sozinho.
- Regras leem **dados** e **referência**.
- Dados e referência **não conhecem** as regras nem os gráficos (são a base; ignoram
  quem os usa).

Se um gráfico "pular" as regras e fizer conta direto no dado cru, você recria o bug que
estamos fugindo (dois painéis divergindo). Essa seta é o que garante o mesmo número em
todo lugar.

**Alerta:** não fragmentar demais. Três arquivos é o ponto ótimo; virar dez recria o
custo de reconciliação. Regra prática: **cada dado é descrito por completo onde é
definido** (nome PT/EN, unidade, origem, dono). Se a regra precisa "adivinhar" a unidade
de um dado, o Arquivo 1 está incompleto.

## 4.6 Fonte única *incluída*, nunca *copiada* (menu e config global)

Menu e configurações globais têm fonte única. Mas o *como* é o que separa editar 1
lugar de editar 10 — e é o pior bug estrutural do dash atual.

- ❌ **Copiar** o código do menu pra dentro de cada página → 10 cópias → mudar um ícone
  = editar 10 arquivos. **É o que o dash de hoje faz** (bloco de menu copiado em 10
  HTMLs).
- ✅ **Incluir** de uma fonte única → o menu mora em **um** arquivo; cada página só diz
  "carrega o menu aqui". Mudou o arquivo → mudou em todas, sem tocar em página nenhuma.

O verbo certo na sua cabeça (e nos pedidos à IA) é **incluir/injetar de uma fonte
única**, nunca **copiar/replicar** — senão a IA literalmente copia e você só descobre
quando dói.

**Config: sim, mas só o que é global.** Não jogar tudo num único arquivo — a config tem
três níveis (ver seção 6):

| Nível | Exemplos | Fonte única incluída? |
|---|---|---|
| **Global** | menu, tema/cores, idioma, período padrão, os 3 arquivos base | Sim — 1 arquivo, incluído em todas |
| **Painel** | quais métricas o painel mostra, layout, ordem | Não — mora **com** o painel |
| **Gráfico** | tipo de viz, toggle, escala | Não — é opção na chamada do gráfico |

Regra: **é global só o que é igual em todo lugar.** Centralizar o específico junto com o
global cria um arquivo gigante que todos editam ao mesmo tempo — o problema de
coordenação multi-pessoa volta.

## 4.7 Contrato do drawer de info (auditoria por construção)

Todo gráfico tem um drawer de "ajuda/proveniência" que se abre ao clicar. Ele tem um
**contrato fixo**: um conjunto de campos que SEMPRE aparecem, mais alguns condicionais.
É o que torna o dash auditável — clico em qualquer número e sei de onde ele veio.

### SEMPRE presente (todo gráfico, sem exceção)

1. **O que é** — a pergunta que o gráfico responde, 1 linha em linguagem de negócio.
2. **Origem** — objeto (deals? contacts?) + **pipeline(s)** considerado(s) (Vendas
   `782758156` / Bid `894130090`) + tipo (`fonte` / `calculado` / `manual` / `híbrido`).
3. **Campos do HubSpot** — nome interno + label de cada propriedade usada.
4. **Colunas do modal**  que devem estar presentes na listagem de deals
5. **Etapas consideradas** — incluídas **e** excluídas, com código (ex.: "exclui
   Perdido"). Explicitar a exclusão importa tanto quanto a inclusão.
6. **Filtro temporal** — **sobre qual propriedade** (`createdate` / `closedate` / data
   custom) + qual janela. É a causa nº 1 de números que não batem.
7. **Outros filtros aplicados** — e principalmente **quais filtros globais este gráfico
   ignora** (ex.: "não responde ao filtro de Executivo"). Filtro silencioso é armadilha.
8. **Unidade + granularidade** — R$ / vidas / deals / % e mês/trimestre. "Receita" sem
   unidade é ambiguidade clássica (TCV? 12m? MRR?).
9. **Regra de contagem / dedup** — por deal ou por vida; deal duplo (fee + corretagem)
   conta 1×.
10. **Última atualização** — data do snapshot / do dado por trás.
11. **Status de validação** — 🟢 validado / 🟠 em revisão.

### QUANDO APLICÁVEL

- **Cálculo/fórmula** — só se `calculado`/`híbrido`.
- **Ponderação/probabilidade + a fonte dela** — ex.: "prob. de etapa puxada ao vivo do
  funil", não fixa.
- **Precedência** — quando há manual + calculado, qual vence (ex.: "faturamento manual
  sobrepõe").
- **Tratamento de faltantes** — deal sem valor/sem data/sem AE: excluído? conta zero?
  (silencioso engana).
- **Selo "✏️ inserido manualmente" + `atualizado_por`** — só dado `manual`/`híbrido`.
- **Link pra reproduzir no HubSpot** — a lista filtrada que gera o mesmo número
  (auditoria de verdade = reprodutível).

### O ponto crítico: o drawer NÃO é escrito à mão

Esses campos são **projetados automaticamente dos 3 arquivos base** (senão desatualizam
— é o risco anotado na Fase 7). O drawer é uma **janela de leitura da camada semântica**:

| Campo do drawer | Vem de |
|---|---|
| Campos do Hub, unidade, origem, dono, atualização | **Dados** (arquivo 1) |
| Etapas, pipelines, códigos | **Referência** (arquivo 3) |
| Cálculo, filtro temporal + propriedade-alvo, outros filtros, precedência, dedup | **Regras** (arquivo 2) |

> **Regra geral que mata a classe inteira de bug "por que não bate?":** todo filtro no
> drawer **nomeia a propriedade sobre a qual age** — não só o temporal. Se o número está
> no gráfico, o catálogo já tem tudo pra explicá-lo, sem ninguém escrever ajuda à mão.

---

# 5. Passo a passo minucioso

Cada fase tem: **objetivo**, **o que VOCÊ decide**, **o que a IA faz**, **entregável**,
**como validar** e **risco a vigiar**. Faça uma fase por vez. Não pule.

## Fase 0 — Charter (fundação, ~meio dia)
- **Objetivo:** saber o que o dash responde e para quem, antes de qualquer pixel.
- **Você decide:** os consumidores e a decisão de cada um (CRO → alocação de AE; BoD →
  meta; CS → churn); as **20 perguntas** que o dash tem que responder; e o checkpoint
  build-vs-buy (4.4).
- **IA faz:** organiza suas respostas, aponta perguntas ambíguas, sugere métricas que
  cada pergunta exige.
- **Entregável:** documento de charter (pode ser uma seção deste arquivo).
- **Validar:** cada painel futuro tem que rastrear até uma dessas 20 perguntas. Se não
  rastreia, é vaidade.
- **Risco:** pular esta fase e construir gráfico bonito que ninguém usa.

## Fase 1 — Os 3 arquivos base (a camada semântica; ver 4.5)
- **Objetivo:** definir cada dado, cada regra e cada referência **uma vez**,
  máquina-legível.
- **Você decide:** para cada métrica das 20 perguntas — o nome (PT/EN), de onde vem,
  qual o cálculo, se é `fonte`/`calculado`/`manual`, quem é o dono.
- **IA faz:** transforma isso nos 3 arquivos estruturados (YAML/JSON), valida
  consistência, aponta duplicatas, dependências circulares e dados sem unidade.
- **Entregável:** `dados.yaml`, `regras.yaml`, `referencia.yaml`. Exemplo de uma
  **regra** (arquivo 2), que referencia dados (arquivo 1) e referência (arquivo 3):

```yaml
receita_probabilizada:
  label:  { pt: "Receita Probabilizada", en: "Weighted Revenue" }
  ajuda:  { pt: "Previsão ponderada...",  en: "Weighted forecast..." }
  grain: mês
  tipo: calculado            # raw | calculado | manual | hibrido
  usa_dados: [valor_deal, prob_etapa]        # → dados.yaml
  usa_referencia: [pipe_vendas, pipe_bid]    # → referencia.yaml
  filtro_temporal: { propriedade: closedate, janela: "12m rolling" }
  filtro: "pipeline in (vendas, bid) AND stage != perdido"
  formula: "Σ (valor_deal_TCV_12m × prob_etapa)  | dedup cliente por menor TCV"
  precedencia: "faturamento_manual sobrepõe quando existir"
  owner: revops
  status: validado           # rascunho | em_revisao | validado | descontinuado
  atualizado_em: 2026-07-07
```

- **Validar:** dois painéis que usam a mesma regra **têm** que mostrar o mesmo número
  (por construção, já que só existe uma definição).
- **Risco:** deixar definição em prosa espalhada (como hoje) → cada IA relê texto
  corrido e gasta token.

## Fase 2 — Ingestão + snapshot versionado
- **Objetivo:** trazer o dado da fonte e **congelar fotos datadas**.
- **Você decide:** com que frequência atualiza; o que precisa de histórico ("quanto era
  em 30/jun?").
- **IA faz:** conector com a fonte, rotina de snapshot, alerta se a captura falhar.
- **Entregável:** ingestão + snapshots datados versionados.
- **Validar:** consigo abrir a foto de um mês passado e o número bate com o que foi
  reportado na época.
- **Risco:** snapshot como remendo (o cron quebrou uma vez e virou foto manual). Trate
  como cidadão de primeira classe.

## Fase 3 — Design system global (tokens, não estilos)
- **Objetivo:** definir o visual **uma vez**.
- **Você decide:** paleta da marca, fonte, densidade; os componentes de UI (card, toggle
  Apple-style, drawer).
- **IA faz:** cria os tokens (variáveis) e os componentes base.
- **Entregável:** arquivo de tokens + biblioteca de UI.
- **Validar:** trocar uma cor no token muda em todos os painéis de uma vez.
- **Risco:** painel inventar cor própria em vez de consumir token.

## Fase 4 — Biblioteca de gráficos parametrizados (o "replicável")
- **Objetivo:** um gráfico = função de `(metric_id, opções)`.
- **Você decide:** os tipos de gráfico que o dash vai ter (barra, linha, funil, tabela).
- **IA faz:** componentes que puxam dado da camada 2, cor da camada 3, texto da camada 6
  e proveniência pro drawer — sozinhos.
- **Entregável:** `renderChart({ metric, tipo, toggle })` reutilizável.
- **Validar:** o mesmo gráfico aparece em Sales e em Board **sem copiar código**.
- **Risco:** o erro estrutural do dash atual — HTML monolítico e bloco de menu copiado
  em 10 arquivos. Do zero: componente de verdade, um lugar só.

## Fase 5 — Um painel completo como referência (golden template)
- **Objetivo:** provar o fluxo inteiro em UM painel antes de espalhar.
- **Você decide:** qual painel (o mais crítico, provavelmente Sales/Forecast).
- **IA faz:** monta ponta a ponta — dados → métrica → gráfico → drill → proveniência →
  bilíngue → validado.
- **Entregável:** 1 painel completo + o "manifesto" declarativo dele.
- **Validar:** todos os números batem com a fonte; troca de idioma funciona; dado manual
  aparece com selo.
- **Risco:** construir 7 painéis meia-boca em vez de 1 exemplar perfeito para copiar.

## Fase 6 — Replicar para os outros domínios
- **Objetivo:** Marketing, CS, Implantação viram composição, não engenharia.
- **Você decide:** quais métricas do catálogo entram em cada painel e em que ordem.
- **IA faz:** escreve o manifesto de cada painel (declarativo) reusando componentes.
- **Entregável:** demais painéis.
- **Validar:** nenhum painel novo exigiu decisão de arquitetura nova.
- **Risco:** deixar vazar cálculo pro painel (violando "painel não calcula").

## Fase 7 — Camada de auditoria/lineage
- **Objetivo:** cada gráfico se explica sozinho na tela, seguindo o **contrato do drawer
  (seção 4.7)**.
- **Você decide:** nada de conteúdo à mão — o contrato 4.7 já fixa o que sempre aparece.
- **IA faz:** o drawer é alimentado **automaticamente** pelos 3 arquivos base (campos do
  Hub, etapas, cálculo, filtro temporal + propriedade-alvo, tipo, atualização, status).
- **Entregável:** proveniência viva em cada gráfico + índice de saúde (🟢🟠🔴).
- **Validar:** clico em qualquer número e vejo os 10 campos obrigatórios da seção 4.7.
- **Risco:** escrever a auditoria à mão (desatualiza). Ela tem que sair da camada semântica.

---

# 6. Hierarquia de config (global vs painel vs gráfico)

Três planos, sem sobreposição. Saber em qual plano mora cada coisa evita duplicação.

| Plano | Contém | Onde vive |
|---|---|---|
| **Global** | tokens visuais, menu/nav, marca, idioma, período padrão, os 3 arquivos base | 1 arquivo cada, fonte única |
| **Painel** | quais métricas mostra, layout, público-alvo, ordem | manifesto do painel (declarativo) |
| **Gráfico** | tipo de viz, toggles, escala, cor por série | props na chamada do componente |

Meta: descrever um painel inteiro como **manifesto declarativo** ("este painel = estas
6 métricas nestes 6 slots"). Painel novo deixa de ser código e vira config — é o que
torna o projeto barato de iterar.

---

# 7. Economia de tokens/tempo com IA

1. **Uma verdade, um lugar.** Duplicação faz a IA reler e reconciliar (caro).
2. **Contrato máquina-legível > prosa.** A IA lê o catálogo em 1 tool call em vez de
   varrer milhares de linhas de HTML.
3. **Arquivos pequenos e compostos.** Editar componente de 80 linhas custa fração de
   reabrir HTML monolítico.
4. **Harness de validação self-service.** Um comando que sobe o app e valida rotas
   deixa a IA se auto-verificar sem te consultar.
5. **Convenções rígidas.** Menos decisão aberta = menos ida e volta.
6. **Commit por entrega validada.** Ponto de restauração barato.
7. **Pedido com critério de aceite** (seção 1.3). O maior multiplicador de todos.

---

# 8. Glossário (jargão de programador em português claro)

| Termo | O que significa na prática |
|---|---|
| **SSOT** (single source of truth) | Cada fato mora em um lugar só |
| **Contrato / interface** | O "encaixe" entre pedaços; você opera aqui, ignora o miolo |
| **Declarativo** | Descrever o resultado, não o passo a passo |
| **Manifesto** | Uma "receita" que descreve um painel em vez de programá-lo |
| **Schema** | O molde/formato de um dado (quais campos ele tem) |
| **i18n** | Internacionalização; deixar o texto trocar de idioma |
| **Token (design)** | Variável de estilo (uma cor, um espaçamento) usada em todo lugar |
| **Idempotente / reproduzível** | Rodar de novo dá o mesmo resultado |
| **Aditivo** | Só adiciona, não mexe no que existe (mudança segura) |
| **Proveniência / lineage** | O rastro de onde o número veio e como foi calculado |
| **Snapshot** | Foto datada do dado, pra poder auditar o passado |
| **Drill / drawer** | Clicar num número e abrir o detalhe por trás dele |

---

# 9. Decisões já fechadas
- ✅ Operar como arquiteto/PM (você faz o spec, a IA programa) — seção 1.
- ✅ Camada semântica dividida em 3 arquivos: **dados / regras / referência**, com seta
  única de dependência — seção 4.5.
- ✅ Dado manual: definição no arquivo, valor no banco, com `origem`, selo e timestamp — seções 4.1 e 4.5.
- ✅ Menu e config global = **fonte única incluída**, nunca copiada; config em 3 níveis — seção 4.6.
- ✅ Bilíngue (PT/EN) por design, texto nunca hardcoded — seção 4.2.
- ✅ Contrato do drawer de info: 10 campos sempre presentes + condicionais, gerados da
  camada semântica; todo filtro nomeia sua propriedade-alvo — seção 4.7.

# 10. Próximos passos possíveis
- [ ] Buscar template.
- [ ] Fase 0: escrever o charter (consumidores + as 20 perguntas + build-vs-buy).
- [ ] Fase 1: esboçar o schema completo dos 3 arquivos base (todos os campos de cada um).
- [ ] Esboçar um manifesto de painel de exemplo (declarativo, bilíngue).
- [ ] Decidir a stack de i18n e de persistência do dado manual.
- [ ] Incorporar as práticas da seção 11 nas fases (migração, vigência de regras, deploy via GitHub, alertas).

---

# 11. Riscos e práticas operacionais (revisão crítica do plano)

> Seção escrita após auditoria do plano contra o **histórico real de incidentes do
> dashboard 1.0**. Itens marcados com 🔥 **já aconteceram neste projeto** — não são
> hipóteses. Um plano multi-pessoa que ignora o que já doeu vai doer de novo.

## 11.1 Processo multi-mãos

| Prática que faltava | O problema que evita | Já doeu? |
|---|---|---|
| **Estratégia de migração 1.0 → 2.0** | O plano descreve o destino, não a travessia. Definir: rodada paralela (2.0 convive com 1.0), **gate de paridade** (um painel 2.0 só substitui o 1.0 quando os números batem), plano de sunset, quem mantém o 1.0 durante a transição. Sem isso: dois projetos meia-boca. | — |
| **Deploy via GitHub, nunca via máquina** | Hoje `vercel --prod` sobe o working tree de quem digitou. Migrar para a integração nativa Vercel↔GitHub: push no `main` = deploy automático; cada branch ganha **URL de preview** própria (cada mão testa a sua sem pisar em ninguém). | 🔥 alias takeover entre sessões (2×, documentado) |
| **Main protegido + PR com revisão** | Os 3 arquivos base são a constituição — mudança neles exige revisão de outra pessoa (ou outra IA). CODEOWNERS por domínio (quem é dono do painel de Marketing?). "Declarar território" é convenção social; não escala além de 2 mãos. | 🔥 divergência de 17+14 commits entre sessões |
| **ADRs (decisões numeradas)** | A seção 9 é um proto-ADR. Formalizar: cada decisão futura com contexto, alternativas descartadas e porquê, numerada, no repo. | — |
| **IDs estáveis e imutáveis** | `metric_id` nunca se recicla nem renumera; ordem de exibição desacoplada do ID. | 🔥 numeração N01–N26 da auditoria já não bate com o dashboard atual |

## 11.2 Dados & cálculo

| Prática que faltava | O problema que evita | Já doeu? |
|---|---|---|
| **Vigência temporal nas regras** | Cada regra do `regras.yaml` carrega `vigente_desde`. Se a régua muda em agosto, junho continua reproduzível com a régua de junho. **A promessa central de auditabilidade ("reproduzir o que dissemos ao board") quebra sem isso** — toda mudança de fórmula reescreveria o passado em silêncio. | parcialmente (dilema registrado na spec do Delta, nunca generalizado) |
| **Fuso horário fixado na ingestão** | HubSpot grava UTC; deal fechado 30/06 às 22h de SP é 01/07 em UTC → **muda o mês da receita**. Decisão: tudo se calcula em `America/Sao_Paulo`, convertido UMA vez na camada 1 — nunca em cada regra. | 🔥 "foto de junho" capturada em 02/07 |
| **Política de arredondamento** | Arredondar só na exibição, nunca no dado; regra declarada para "soma das partes ≠ total" (hoje é tolerância ad-hoc no teste do Delta). | — |
| **Validação na ingestão** | Deal sem `vidas`, `closedate` < `createdate`, `pf` ausente: sinalizar na entrada, contadores de completude ("X de Y completos") como cidadãos da camada 1, processo para lixo conhecido (motivos de perda "outros"). | 🔥 roster de motivos de perda inválido (README, princípio 5) |
| **Edição concorrente do dado manual** | Duas pessoas editam a meta ao mesmo tempo: quem vence? Definir last-write-wins com aviso, ou rascunho→publicado. | — |
| **Backup do que não está no git** | "Persistência fora do código" resolve o deploy-apaga e cria o problema seguinte: KV e planilhas não têm histórico. Rotina de export versionado (barata, automatizável). | — |

## 11.3 Operação & confiabilidade

| Prática que faltava | O problema que evita | Já doeu? |
|---|---|---|
| **Falha silenciosa é proibida** | Todo job agendado reporta sucesso ou grita num canal humano (Slack/e-mail). Health-check do próprio dashboard. | 🔥 cron de snapshot falhou com 401 toda noite por UM MÊS, em silêncio |
| **Cache e rate limit como arquitetura** | Política de cache por fonte (TTL declarado), orçamento de chamadas por página — não sessionStorage improvisado por painel. | 🔥 painel AE tomou rate limit do HubSpot no load |
| **Limites de plataforma como decisão explícita** | Teto de 12 funções serverless (Hobby) já força gambiarra (`action=` dentro de endpoint existente); Sheets-como-banco tem teto de células. Decidir: plano pago? consolidar? migrar storage? | 🔥 deploy já falhou por env var; endpoint novo já foi vetado pelo teto |
| **SLA de frescor por fonte** | O drawer mostra "última atualização"; falta o contrato: idade máxima aceitável por dado + badge automático ao estourar (o plano previa isso só para dado manual — dado de fonte também envelhece). | — |

## 11.4 Design & UX

- **Export para apresentação** — o consumidor final é o BoD: números deste dash viram slide. Export PNG/CSV por gráfico é o caso de uso do stakeholder nº 2 (Mariano), não luxo.
- **Estado compartilhável por URL** — filtros/período/idioma na URL: "olha esse gráfico" vira um link, não um print com instruções. Barato na fundação, caro depois.
- **Mobile + acessibilidade** — diretoria abre no celular. Contraste, paleta segura para daltonismo (⚠ verde/vermelho é a codificação principal do dash), navegação por teclado.
- **Estados vazios/carregando/erro como design** — o que aparece quando a API falha ou o filtro zera é parte do design system (Fase 3), não improviso de cada painel.

## 11.5 Estratégico

- **Telemetria de uso** — o 1.0 tem ~370 visualizações e ninguém sabe quais são olhadas. Pós-lançamento, medir uso para podar vaidade; senão o 2.0 re-acumula gráficos mortos.
- **Build-vs-buy incompleto** — o checkpoint da seção 4.4 compara "custom vs. Metabase/Looker" (tudo-ou-nada). Falta a opção híbrida mais aderente: **o coração do plano (camada semântica) é exatamente o que ferramentas de metrics layer fazem** (dbt metrics, Cube.dev, Evidence.dev). Avaliar "front custom + camada semântica pronta" antes da Fase 1.
- **Papéis de acesso (RBAC) + LGPD** — hoje o OAuth é tudo-ou-nada (@axenya.com). Definir: BoD vê tudo? AE vê só o seu? Quem PODE editar dado manual? Dados de deal têm nome de empresa/contato — retenção e acesso são tema LGPD.

## 11.6 Os 5 a incorporar primeiro

| # | Item | Por quê primeiro |
|---|---|---|
| 1 | Migração 1.0→2.0 com gate de paridade | Sem travessia, o plano é um mapa sem estrada |
| 2 | Regras com `vigente_desde` | A promessa de auditabilidade quebra sem isso |
| 3 | Deploy via GitHub + previews | Elimina a classe de incidente que já ocorreu 2× |
| 4 | Alerta de falha silenciosa | O cron mudo por um mês foi o aviso de graça |
| 5 | Fuso horário fixado na ingestão | Bug invisível que corrompe o mês da receita |





--

Qual é maneira mais inteligente de planejar a construção de um dashboard principal da empresa, que vai servir como a fonte de todo o conhecimento da empresa, de marketing, sales, cs, implantação, etc? Qual o passo a passo mais organizado pra economizar o máximo de tempo e de tokens? Imagine que eu quisesse construir um dash como o nosso do zero. Existem configurações que são globais, outras que são de cada painel, mas existe um visual geral, etc... Esse dash precisa ser auditável, ter gráficos que poderão ser replicados entre painéis... Existe a necessidade de saber de onde os dados vêm, quais cálculos são feitos, etc.


- Todas as lideranças consomem seus paineis
- 

Preciso que seja otimizado tb pra poder incrementar e iterar no futuro. Alguns dados e taxas calculados, outros dados inferidos manualmente

Precisa ser bilingue

Penso que primeiro tenho que definir os dados que usarei (e eles serão minha base, sempre que ue precisar adicionar, é nele que adicionarei); em outro arquivo, os cálculos e regras, então sempre que um gráfico for usar os dados, é de lá que ele tira; outro arquivo com as infos de pipe, etapas, etc... Faz setndio?

Penso tb que o menu seja um só, que nós vamos replicar em todas as páginas, sem precisar criar vários arquivos. O mesmo acontece com as configurações, certo?

No drawer de infos, eu preciso saber exatamente quais infos SEMPRE ter:
- campos do hub
- etapas consideradas
- cálculos feitos (quando aplicável)
- filtro temporal (é aplicado sobre qual propriedade)





Painel Forecast
- Os códigos do pipe e etapas são:
	- Pipe Vendas: 782758156
		- Reunião: 1144746905
		- Diagnóstico 1144746906
		- Cotação 1144746908
		- Consultoria 1144746909
		- Negociação 1144746910
		- Implantação 1288611084
		- Ganho 1144844314
		- Perdido 1144746911
	- Pipe de BID: 894130090
		- Reunião 1349620551
		- Convite enviado 1349620552
		- Documentação 1349620553
		- RFP Enviada 1349620554
		- Cotação 1363560722
		- Proposta enviada 1349620555
		- Standby 1373066362
		- Consultoria 1349620556
		- Negociação 1353387279
		- Ganho 1353387280
		- Implantação 1353457025
		- Perdido 1349620557

É preciso que o usuário possa escolher as etapas que escolhe considerar como ativos, especialmente Reunião e Standby



ATENÇÃO:
Mas também sempre útil ter no github todo o histórico de decisões até chegar nas premissas  
Ajuda bem quando alguém querer entender o racional completo


FORECAST
Probabilidade de etapas: existe um gráfico que calcula a probabilidade de fechamento automaticamente com as informações do funil, e existem premissas das quais partimos em probabilidade. Preciso que, no menu de configurações globais, haja um toggle pra selecionar se a probabilidade considerada deve ser a forçada, ou a calculada em tempo real. 
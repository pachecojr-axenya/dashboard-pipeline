'use strict';

// Memórias de cálculo específicas por card/gráfico do Workload.
// Este módulo enriquece os botões "i" gerados pelo bundle v2 sem duplicar a lógica de dados.
(function () {
  function clean(value) {
    return String(value || '').replace(/\s+i\s*$/i, '').replace(/\s+/g, ' ').trim();
  }

  var FRIENDLY_LABELS = {
    'CRM': 'Movimentos no CRM',
    'SQL': 'Leads qualificados (SQL)',
    'p50 reatividade': 'Tempo mediano até o 1º toque',
    'Cobertura': 'Cobertura de toque',
    'Elegíveis': 'Empresas elegíveis'
  };

  var GLOSSARY = [
    ['BDR', 'Pessoa do time comercial responsável por pesquisar empresas, abordar contatos e gerar oportunidades para os executivos de vendas.'],
    ['Contato elegível', 'Contato que virou Lead no HubSpot, está ligado a uma empresa e tem como dono um BDR do roster ativo do time. A data em que esse Lead foi criado precisa estar dentro do período selecionado. Não significa todos os contatos do HubSpot nem toda a carteira do BDR.'],
    ['Empresa elegível', 'Empresa que tem pelo menos um contato elegível para aquele BDR. A mesma empresa com dois BDRs diferentes é analisada separadamente para cada BDR.'],
    ['Toque', 'Tentativa comercial registrada: ligação, e-mail enviado, WhatsApp enviado, mensagem de LinkedIn enviada ou reunião. Notas e tarefas internas não contam.'],
    ['Contato tocado', 'Contato elegível que recebeu pelo menos um toque. Mesmo com várias tentativas, ele conta uma única vez nesta métrica.'],
    ['Cobertura de toque', 'Percentual dos contatos elegíveis que receberam ao menos um toque: contatos tocados dividido por contatos elegíveis.'],
    ['Contato efetivo', 'Contato cujo status foi alterado para CONNECTED no CRM, indicando que houve retorno ou conversa, e não apenas uma tentativa.'],
    ['SQL', 'Oportunidade comercial qualificada que virou um negócio registrado para o time de vendas.'],
    ['p50 ou mediana', 'Valor que divide o grupo ao meio. Exemplo: p50 de 3 horas significa que metade recebeu o primeiro toque em até 3 horas e metade demorou mais.'],
    ['ICP', 'Perfil de empresa que a Axenya considera mais adequado para vender, analisado aqui por porte, segmento e persona.'],
    ['Desfecho da ligação', 'O que o BDR escolheu no menu de desfecho do HubSpot depois de ligar (Conectado, Sem resposta, Ocupado, Número errado, Recado de voz, Reunião agendada). É um CARIMBO manual: nada no sistema detecta sozinho se a pessoa atendeu.'],
    ['Conectada', 'Ligação cujo desfecho o BDR carimbou como "Conectado". Não é o mesmo que "alguém atendeu": se o BDR conversou e carimbou "Sem resposta", a ligação não entra aqui. Por isso existe o card "Longas sem conexão", que mostra quantas ligações de 60 segundos ou mais ficaram fora desse carimbo.'],
    ['Longa sem conexão', 'Ligação de 60 segundos ou mais que NÃO foi carimbada como Conectada. Serve para auditar o carimbo, não para somar: telefone tocando não costuma passar de um minuto, então uma ligação longa marcada como "Sem resposta" quase sempre é conversa que não foi registrada.']
  ];

  function entry(title) {
    var t = clean(title);
    var lower = t.toLowerCase();
    var sourceRhythm = 'Os dados vêm das atividades registradas no HubSpot e consolidadas no BigQuery; quando o período inclui hoje, as atividades mais recentes são somadas em tempo real.';
    var sourceEligible = 'Os dados vêm dos Leads e das atividades do HubSpot consolidados no BigQuery, sempre respeitando período, BDR e demais filtros selecionados.';
    var exact = {
      'Atividades': ['Quantas ações comerciais foram registradas?', 'Soma todas as tentativas dos cinco canais. Uma ligação e um e-mail para a mesma pessoa contam como duas atividades.', 'Atividades = ligações + e-mails enviados + WhatsApp enviados + mensagens de LinkedIn enviadas + reuniões. Notas e tarefas internas ficam fora. ' + sourceRhythm],
      'Empresas tocadas': ['Com quantas empresas diferentes o time tentou falar?', 'Cada empresa conta uma única vez, mesmo que vários contatos dela tenham recebido várias tentativas.', 'Contamos uma vez cada empresa associada a pelo menos uma atividade válida. ' + sourceRhythm],
      'Contatos tocados': ['Com quantas pessoas diferentes o time tentou falar?', 'Cada contato conta uma única vez, mesmo que tenha recebido ligação, e-mail e WhatsApp.', 'Contamos uma vez cada contato associado a pelo menos uma atividade válida. ' + sourceRhythm],
      'Movimentos no CRM': ['Quantas vezes o time atualizou o avanço dos contatos no funil?', 'Conta mudanças de status ou etapa, como passar de “tentativa” para “conectado”. Não representa mensagens ou ligações.', 'Somamos cada mudança de status ou etapa registrada no período. Os dados vêm do histórico do CRM.'],
      'Contato efetivo': ['Com quantas pessoas houve retorno ou conversa registrada?', 'Conta quando o contato chega ao status CONNECTED. Uma tentativa sem retorno não entra.', 'Contamos cada contato que mudou para CONNECTED no período. Os dados vêm do histórico de status do HubSpot.'],
      'Leads qualificados (SQL)': ['Quantas oportunidades qualificadas foram entregues para vendas?', 'Conta negócios reais classificados como SQL, não apenas contatos que avançaram de status.', 'Contamos os negócios qualificados associados ao BDR e ao período. A fonte é a base comercial consolidada no BigQuery.'],
      'Tempo mediano até o 1º toque': ['Quanto tempo o time leva para abordar um contato elegível pela primeira vez?', 'É a mediana: metade dos contatos foi abordada nesse tempo ou menos; a outra metade demorou mais.', 'Para cada contato elegível, calculamos as horas entre a criação do Lead e o primeiro toque posterior; depois usamos a mediana. ' + sourceEligible],
      'Cobertura de toque': ['Que parte dos contatos que deveriam ser trabalhados recebeu alguma abordagem?', '100% significa que todos os contatos elegíveis receberam ao menos um toque. Não mede se porte, segmento ou persona estão preenchidos.', 'Cobertura de toque = contatos elegíveis com pelo menos um toque ÷ todos os contatos elegíveis × 100. ' + sourceEligible],
      'Empresas elegíveis': ['Quantas empresas entraram no universo de trabalho dos BDRs?', 'Uma empresa entra quando tem pelo menos um contato que virou Lead, está ligado a ela e pertence a um BDR ativo no período.', 'Contamos uma vez cada combinação de empresa e BDR que tenha ao menos um contato elegível. Não é toda a carteira do BDR. ' + sourceEligible],
      'Contatos elegíveis': ['Quantas pessoas entraram no universo que deveria ser trabalhado?', 'Um contato é elegível quando virou Lead no HubSpot, está ligado a uma empresa, pertence a um BDR ativo e entrou no período selecionado.', 'Contamos cada contato que atende aos quatro critérios do glossário. Não é todo contato existente no HubSpot. ' + sourceEligible],
      'Toques reais': ['Quantas tentativas comerciais foram feitas nos contatos elegíveis?', 'Aqui cada tentativa conta. Se a mesma pessoa recebeu uma ligação e dois e-mails, são três toques.', 'Somamos ligações, e-mails enviados, WhatsApp enviados, mensagens de LinkedIn enviadas e reuniões ligados aos contatos elegíveis. ' + sourceEligible],
      'Cobertura porte': ['Quanto das empresas elegíveis tem o porte conhecido?', 'Mostra qualidade de preenchimento do cadastro. Não informa se os contatos receberam abordagem.', 'Cobertura de porte = empresas elegíveis com porte preenchido ÷ empresas elegíveis × 100.'],
      'Cobertura segmento': ['Quanto das empresas elegíveis tem o segmento conhecido?', 'Mostra qualidade de preenchimento do cadastro. Não informa se os contatos receberam abordagem.', 'Cobertura de segmento = empresas elegíveis com segmento preenchido ÷ empresas elegíveis × 100.'],
      'Ligações': ['Quantas ligações foram feitas?', 'Conta cada registro de chamada criado no HubSpot no período, tenha a pessoa atendido ou não. Uma mesma pessoa ligada três vezes conta três.', 'Ligações = COUNT de atividades de chamada por dono e data. O total bate na vírgula com a busca de chamadas do HubSpot: auditado em 10-13/08/2026 com um BDR (124 no dashboard, 124 no HubSpot). ' + sourceRhythm],
      'Conectadas': ['Em quantas ligações o BDR registrou que houve conversa?', 'ATENÇÃO: é o carimbo do BDR, não a detecção de quem atendeu. Uma conversa real carimbada como "Sem resposta" não aparece aqui, e o desfecho "Reunião agendada" — que existe no portal — não é reconhecido por nenhuma camada e cai em "sem desfecho". Leia sempre junto do card "Longas sem conexão".', 'Conectadas = ligações com hs_call_disposition igual a "Conectado" (GUID f240bbac). Os outros desfechos do portal (Sem resposta, Ocupado, Número errado, Recado de voz, Mensagem ativa) ficam fora. Régua não é uniforme no time: em 10-14/08/2026 dois BDRs carimbaram 100% "Ocupado" e zero "Sem resposta", enquanto outros seis fizeram o inverso — comparar taxa de conexão entre BDRs hoje mede o hábito de carimbo tanto quanto o telefone.'],
      'Taxa de conexão': ['Que parte das ligações o BDR registrou como conversa?', 'Sobe e desce por dois motivos diferentes: quem atende e como o BDR carimba. Antes de concluir que um BDR conecta menos, confira "Longas sem conexão" dele.', 'Taxa de conexão = ligações com desfecho "Conectado" ÷ total de ligações × 100. Não há detecção automática de atendimento — o denominador é confiável, o numerador depende do carimbo.'],
      'Longas sem conexão': ['Quantas ligações duraram o suficiente para ser conversa mas não foram carimbadas como conectadas?', 'É um alerta de qualidade do registro, não um canal. Se o número é alto, a taxa de conexão da tela está subestimada e o coaching deve começar pelo preenchimento do desfecho. Clique para ver as ligações uma a uma e abrir o contato ou a empresa no HubSpot.', 'Longas sem conexão = ligações que duraram 60 segundos ou mais e cujo desfecho é diferente de "Conectado". 60s é o mesmo piso de conversa que o detalhamento de calls já usa. Nada é reclassificado: "Conectadas" continua contando só o carimbo. Fonte: mart de toques do armazém, cruzado com o desfecho cru para também identificar o "Reunião agendada" que as camadas não mapeiam.'],
      'Sem conexão': ['Quantas ligações não resultaram em conversa registrada?', 'Junta "Sem resposta", "Ocupado", "Número errado" e as sem desfecho preenchido. Recado em voicemail tem card próprio.', 'Sem conexão = ligações cujo desfecho não é "Conectado" nem recado de voz. Parte deste balde pode ser conversa mal carimbada — veja "Longas sem conexão".'],
      'Tempo em linha': ['Quanto tempo o time passou efetivamente em conversa?', 'Soma apenas a duração das ligações carimbadas como conectadas. Se uma conversa foi carimbada errado, o tempo dela não entra aqui.', 'Tempo em linha = SOMA da duração das ligações com desfecho "Conectado". Duração de não conectada é ringing ou espera, não esforço de conversa, e por isso fica fora.'],
      'Recado/voicemail': ['Em quantas ligações o BDR deixou recado?', 'Tem output (a mensagem foi deixada) mas não é conversa, então tem balde próprio e não entra em conectadas.', 'Recado = ligações com desfecho "Deixou mensagem de voz" ou "Deixou mensagem ativa".'],
      'Cobertura persona': ['Quanto dos contatos elegíveis tem a função ou perfil profissional classificado?', 'Mostra qualidade de preenchimento da persona. Não informa se o contato recebeu abordagem.', 'Cobertura de persona = contatos elegíveis com persona classificada ÷ contatos elegíveis × 100.']
    };
    if (exact[t]) return [t].concat(exact[t]);

    if (/^(ligações|e-mails|whatsapp|linkedin|reuniões)$/.test(lower)) {
      return [t, 'Qual foi o volume deste canal?', 'Conta somente atividades válidas do canal no período e filtros selecionados.', t + ' = COUNT de atividades classificadas neste canal. ' + sourceRhythm];
    }
    if (lower.indexOf('volume diário por canal') >= 0) return [t, 'Como o volume e o mix de canais variaram por dia?', 'O tamanho da barra mostra o total diário; cada cor mostra a participação de um canal.', 'Total do dia = soma dos cinco canais; cada segmento = atividades daquele canal. ' + sourceRhythm];
    if (lower.indexOf('evolução do ritmo') >= 0) return [t, 'O ritmo de atividades está acelerando ou desacelerando?', 'Leia a sequência diária; os rótulos destacam o pico e o último dia da janela.', 'Ritmo diário = soma dos cinco canais por data. ' + sourceRhythm];
    if (lower.indexOf('tempo até o 1º toque') >= 0) return [t, 'Quão rápido os leads elegíveis recebem o primeiro toque?', 'Cada faixa agrupa leads pelo tempo entre elegibilidade e primeiro toque; sem toque fica separado.', 'Bucket = diferença entre eligible_at e primeiro toque posterior. ' + sourceEligible];
    if (lower.indexOf('reatividade por bdr') >= 0) return [t, 'Quais BDRs tocam mais rapidamente os leads elegíveis?', 'Compare a mediana de horas; menor é melhor. O volume elegível deve ser lido junto.', 'Por BDR: mediana de horas até o primeiro toque posterior. ' + sourceEligible];
    if (lower.indexOf('variação por canal') >= 0) return [t, 'Qual canal ganhou ou perdeu volume contra o período anterior?', 'Valor positivo indica aumento; negativo indica queda, usando janelas equivalentes.', 'Variação = atividades do canal no período atual − período anterior equivalente. Fonte: /api/bdr-workload-compare.'];
    if (lower.indexOf('atual × anterior') >= 0 || lower.indexOf('atual x anterior') >= 0) return [t, 'Como o volume atual se compara ao anterior em cada canal?', 'As barras lado a lado usam janelas com a mesma quantidade de dias.', 'Cada barra = COUNT de atividades do canal em sua janela. Fonte: /api/bdr-workload-compare.'];
    if (lower.indexOf('ligações:') >= 0 || lower.indexOf('ligações |') >= 0) return [t, 'As ligações conectaram de fato ou foram só tentativa?', 'Conectada é a ligação cujo desfecho o BDR registrou como "Conectado" no HubSpot. Recado em voicemail tem output mas não é conversa, então fica num bucket próprio.', 'Taxa de conexão = ligações com desfecho "Conectado" (hs_call_disposition) ÷ total de ligações. Tempo em linha soma a duração apenas das conectadas — duração de não-conectada é ringing/espera, não esforço real. Fonte: atividades de chamada do Workload.'];
    if (lower.indexOf('ritmo por bdr') >= 0 || lower.indexOf('canais por bdr') >= 0 || lower.indexOf('resultado por bdr') >= 0) return [t, 'Como cada BDR evoluiu ao longo dos dias?', 'Cada linha representa um BDR; média móvel suaviza oscilações e mediana/média servem de referência.', 'Série = métrica selecionada agregada por data + BDR. ' + sourceRhythm];
    if (lower.indexOf('contatos por nº de toques') >= 0 || lower.indexOf('contatos por número de toques') >= 0) return [t, 'Quantos contatos receberam zero, um ou vários toques?', 'O bucket zero mostra contatos elegíveis ainda não trabalhados; os demais mostram intensidade.', 'Bucket = quantidade de toques reais por contato elegível. ' + sourceEligible];
    if (lower.indexOf('elegíveis por') >= 0 || lower.indexOf('por porte') >= 0 || lower.indexOf('por segmento') >= 0 || lower.indexOf('por persona') >= 0) return [t, 'Como a coorte elegível se distribui nesta dimensão?', 'A barra mostra o volume elegível; a tabela mostra tocados e cobertura de toque dentro de cada grupo.', 'Cobertura de toque do grupo = contatos tocados ÷ contatos elegíveis do grupo × 100. ' + sourceEligible];
    if (lower.indexOf('comparativo por setor') >= 0) return [t, 'Quais grupos de ICP concentram volume e cobertura de toque?', 'Compare porte, segmento e persona sem misturar os denominadores de cada dimensão.', 'Volume = elegíveis por grupo; cobertura de toque = tocados ÷ elegíveis do mesmo grupo. ' + sourceEligible];
    if (lower.indexOf('gestão por bdr') >= 0 || lower.indexOf('ranking') >= 0) return [t, 'Como o volume e os resultados se distribuem entre BDRs?', 'Ordene pela métrica desejada e clique no BDR ou célula para abrir o detalhe nominal.', 'Cada célula agrega a métrica por owner canônico no período. Fonte: camada semântica do Workload.'];
    if (lower.indexOf('comparação') >= 0 || lower.indexOf('evolução') >= 0) return [t, 'O que mudou entre as duas janelas?', 'A é a janela de referência e B é a janela atual; leia o delta junto do total de cada período.', 'Delta = total B − total A, com os mesmos filtros e domínio. Fonte: /api/bdr-workload-compare.'];

    return [t, 'Que informação este card mostra?', 'Mostra ' + t.toLowerCase() + ' considerando o período, os BDRs e os demais filtros escolhidos. Clique no número ou no gráfico para ver os registros que formam o total, quando essa lista estiver disponível.', 'O total é calculado com os registros do HubSpot consolidados no BigQuery, sempre usando os filtros visíveis na tela.'];
  }

  function open(title) {
    var data = entry(title);
    var drawer = document.getElementById('v2-info-drawer');
    var backdrop = document.getElementById('v2-info-backdrop');
    var heading = document.getElementById('v2-info-title');
    var body = document.getElementById('v2-info-body');
    if (!drawer || !heading || !body) return;
    heading.textContent = data[0];
    body.textContent = '';
    var glossary = document.createElement('div');
    var glossaryTitle = document.createElement('b');
    glossary.className = 'help-block';
    glossaryTitle.textContent = 'Glossário essencial';
    glossary.appendChild(glossaryTitle);
    GLOSSARY.forEach(function (item) {
      var line = document.createElement('p');
      var term = document.createElement('span');
      term.style.fontWeight = '800';
      term.style.color = 'var(--text)';
      term.textContent = item[0] + ': ';
      line.appendChild(term);
      line.appendChild(document.createTextNode(item[1]));
      glossary.appendChild(line);
    });
    body.appendChild(glossary);
    ['O que isso responde', 'Como interpretar', 'Como é calculado e de onde vêm os dados'].forEach(function (label, index) {
      var block = document.createElement('div');
      var strong = document.createElement('b');
      var paragraph = document.createElement('p');
      block.className = 'help-block';
      strong.textContent = label;
      paragraph.textContent = data[index + 1];
      block.appendChild(strong);
      block.appendChild(paragraph);
      body.appendChild(block);
    });
    drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
  }

  function bindButton(button, title) {
    if (!button || button.getAttribute('data-workload-info-bound') === '1') return;
    button.setAttribute('data-workload-info-bound', '1');
    button.setAttribute('aria-label', 'Memória de cálculo | ' + clean(title));
    button.removeAttribute('onclick');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      open(title);
    });
  }

  function bind(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var intro = document.getElementById('workload-intro');
    if (intro && intro.getAttribute('data-coverage-defined') !== '1') {
      intro.setAttribute('data-coverage-defined', '1');
      intro.textContent = 'Como ler | Contato elegível é a pessoa que virou Lead no HubSpot, está ligada a uma empresa, pertence a um BDR ativo e entrou no período selecionado. Cobertura de toque mostra quantos desses contatos receberam ao menos uma abordagem. Cobertura de porte, segmento ou persona mostra apenas se o cadastro tem aquela informação preenchida. Abra o ícone i de qualquer card para ver o glossário, o cálculo e a origem dos dados.';
    }
    Array.prototype.forEach.call(scope.querySelectorAll('.v2-kpi'), function (card) {
      var label = card.querySelector('.label');
      var title = clean((label || {}).textContent);
      if (FRIENDLY_LABELS[title]) {
        title = FRIENDLY_LABELS[title];
        label.textContent = title;
      }
      Array.prototype.forEach.call(card.querySelectorAll('button:not(.v2-kpi-main)'), function (button) { bindButton(button, title); });
    });
    Array.prototype.forEach.call(scope.querySelectorAll('.card h2'), function (heading) {
      var title = clean(heading.textContent);
      Array.prototype.forEach.call(heading.querySelectorAll('button'), function (button) { bindButton(button, title); });
    });
  }

  window.WorkloadBDRInfo = { open: open, describe: entry, bind: bind };
  window.addEventListener('DOMContentLoaded', function () {
    var panel = document.getElementById('content') || document.body;
    bind(document);
    if (panel && window.MutationObserver) new MutationObserver(function () { bind(panel); }).observe(panel, { childList: true, subtree: true });
  });
})();

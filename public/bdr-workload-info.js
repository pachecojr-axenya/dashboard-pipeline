'use strict';

// Memórias de cálculo específicas por card/gráfico do Workload.
// Este módulo enriquece os botões "i" gerados pelo bundle v2 sem duplicar a lógica de dados.
(function () {
  function clean(value) {
    return String(value || '').replace(/\s+i\s*$/i, '').replace(/\s+/g, ' ').trim();
  }

  function entry(title) {
    var t = clean(title);
    var lower = t.toLowerCase();
    var sourceRhythm = 'Fonte: bdr_workload_daily_dimension_v2, com overlay live quando a janela inclui hoje.';
    var sourceEligible = 'Fonte: bdr_workload_reactivity_v2 e bdr_workload_company_contact_v2, respeitando os filtros ativos.';
    var exact = {
      'Atividades': ['Quantas ações operacionais o time executou?', 'Soma ligações, e-mails enviados, WhatsApp, LinkedIn e reuniões. Notas e tarefas não entram.', 'Atividades = ligações + e-mails enviados + WhatsApp + LinkedIn + reuniões. ' + sourceRhythm],
      'Empresas tocadas': ['Quantas empresas distintas receberam ao menos uma atividade?', 'Uma empresa conta uma vez, mesmo que tenha vários contatos ou atividades no período.', 'Empresas tocadas = COUNT DISTINCT company_id associado às atividades. ' + sourceRhythm],
      'Contatos tocados': ['Quantos contatos distintos receberam ao menos uma atividade?', 'Um contato conta uma vez, independentemente da quantidade de tentativas.', 'Contatos tocados = COUNT DISTINCT contact_id associado às atividades. ' + sourceRhythm],
      'CRM': ['Quantas movimentações de funil foram registradas?', 'Conta mudanças de status ou etapa. Não é o total de mensagens, ligações ou e-mails enviados.', 'CRM = contagem de transições de status/etapa na janela. Fonte: camada semântica de CRM do Workload.'],
      'Contato efetivo': ['Quantos contatos chegaram a uma interação efetiva?', 'Conta a entrada no estado CONNECTED; é um resultado de CRM, não uma tentativa de contato.', 'Contato efetivo = COUNT de transições para CONNECTED na janela. Fonte: camada semântica de CRM do Workload.'],
      'SQL': ['Quantos negócios qualificados foram registrados?', 'Conta SQL real associado ao BDR e à janela selecionada.', 'SQL = COUNT de deals qualificados na tabela silver do BigQuery. Não usa OPEN_DEAL como realizado.'],
      'p50 reatividade': ['Em quanto tempo metade dos leads elegíveis recebeu o primeiro toque?', 'p50 é a mediana: 50% receberam o primeiro toque em até esse tempo e 50% demoraram mais.', 'p50 = mediana de horas entre eligible_at e o primeiro toque posterior. ' + sourceEligible],
      'Cobertura': ['Qual parcela dos contatos elegíveis recebeu pelo menos um toque?', 'É cobertura de toque. Não mede preenchimento de porte, segmento ou persona.', 'Cobertura de toque = contatos elegíveis tocados ÷ contatos elegíveis × 100. ' + sourceEligible],
      'Elegíveis': ['Quantas empresas da coorte podem ser analisadas nesta aba?', 'O denominador é empresa + owner com lead elegível criado na janela, não o território total do BDR.', 'Elegíveis = COUNT DISTINCT company_id + owner_id na coorte do período. Fonte: bdr_workload_company_v2.'],
      'Contatos elegíveis': ['Quantos contatos pertencem à coorte elegível?', 'É o universo usado para calcular toque e distribuição; não significa contato criado manualmente pelo BDR.', 'Contatos elegíveis = COUNT de contatos vinculados às empresas elegíveis. ' + sourceEligible],
      'Toques reais': ['Quantas atividades válidas atingiram a coorte elegível?', 'Diferentemente de contatos tocados, aqui cada toque conta; um contato pode contribuir várias vezes.', 'Toques reais = soma de atividades associadas aos contatos da coorte. ' + sourceEligible],
      'Cobertura porte': ['Quanto do universo elegível tem o porte preenchido?', 'É completude do atributo porte. Não é a taxa de contatos tocados.', 'Cobertura de porte = elegíveis com porte preenchido ÷ total de elegíveis × 100. Fonte: bdr_workload_company_v2.'],
      'Cobertura segmento': ['Quanto do universo elegível tem o segmento preenchido?', 'É completude do atributo segmento. Não é a taxa de contatos tocados.', 'Cobertura de segmento = elegíveis com segmento preenchido ÷ total de elegíveis × 100. Fonte: bdr_workload_company_v2.'],
      'Cobertura persona': ['Quanto do universo elegível tem a persona preenchida?', 'É completude do atributo persona. Não é a taxa de contatos tocados.', 'Cobertura de persona = contatos elegíveis com persona preenchida ÷ contatos elegíveis × 100. Fonte: bdr_workload_company_contact_v2.']
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
    if (lower.indexOf('ligações:') >= 0 || lower.indexOf('ligações |') >= 0) return [t, 'As ligações geraram conversa ou apenas discagem?', 'Conversa é ligação com duração de pelo menos 1 minuto; as demais são discagens.', 'Taxa de conversa = ligações com duração ≥ 60 s ÷ total de ligações. Fonte: atividades de chamada do Workload.'];
    if (lower.indexOf('ritmo por bdr') >= 0 || lower.indexOf('canais por bdr') >= 0 || lower.indexOf('resultado por bdr') >= 0) return [t, 'Como cada BDR evoluiu ao longo dos dias?', 'Cada linha representa um BDR; média móvel suaviza oscilações e mediana/média servem de referência.', 'Série = métrica selecionada agregada por data + BDR. ' + sourceRhythm];
    if (lower.indexOf('contatos por nº de toques') >= 0 || lower.indexOf('contatos por número de toques') >= 0) return [t, 'Quantos contatos receberam zero, um ou vários toques?', 'O bucket zero mostra contatos elegíveis ainda não trabalhados; os demais mostram intensidade.', 'Bucket = quantidade de toques reais por contato elegível. ' + sourceEligible];
    if (lower.indexOf('elegíveis por') >= 0 || lower.indexOf('por porte') >= 0 || lower.indexOf('por segmento') >= 0 || lower.indexOf('por persona') >= 0) return [t, 'Como a coorte elegível se distribui nesta dimensão?', 'A barra mostra o volume elegível; a tabela mostra tocados e cobertura de toque dentro de cada grupo.', 'Cobertura de toque do grupo = contatos tocados ÷ contatos elegíveis do grupo × 100. ' + sourceEligible];
    if (lower.indexOf('comparativo por setor') >= 0) return [t, 'Quais grupos de ICP concentram volume e cobertura de toque?', 'Compare porte, segmento e persona sem misturar os denominadores de cada dimensão.', 'Volume = elegíveis por grupo; cobertura de toque = tocados ÷ elegíveis do mesmo grupo. ' + sourceEligible];
    if (lower.indexOf('gestão por bdr') >= 0 || lower.indexOf('ranking') >= 0) return [t, 'Como o volume e os resultados se distribuem entre BDRs?', 'Ordene pela métrica desejada e clique no BDR ou célula para abrir o detalhe nominal.', 'Cada célula agrega a métrica por owner canônico no período. Fonte: camada semântica do Workload.'];
    if (lower.indexOf('comparação') >= 0 || lower.indexOf('evolução') >= 0) return [t, 'O que mudou entre as duas janelas?', 'A é a janela de referência e B é a janela atual; leia o delta junto do total de cada período.', 'Delta = total B − total A, com os mesmos filtros e domínio. Fonte: /api/bdr-workload-compare.'];

    return [t, 'O que este card informa?', 'Mostra ' + t.toLowerCase() + ' dentro do período, BDRs e dimensões selecionados. Clique no dado para abrir o drill nominal quando disponível.', 'A agregação segue a definição exibida no título e os filtros ativos. Fonte: API semântica do Workload correspondente à aba.'];
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
    ['Pergunta', 'Como ler', 'Fórmula e fonte'].forEach(function (label, index) {
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
      intro.textContent = 'Workload v2 | Cobertura de toque = contatos elegíveis tocados ÷ contatos elegíveis. Cobertura de porte, segmento ou persona = percentual do universo elegível com aquele atributo preenchido. São conceitos diferentes. Todo KPI e gráfico tem memória de cálculo própria no ícone i e drill auditável quando disponível.';
    }
    Array.prototype.forEach.call(scope.querySelectorAll('.v2-kpi'), function (card) {
      var title = clean((card.querySelector('.label') || {}).textContent);
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

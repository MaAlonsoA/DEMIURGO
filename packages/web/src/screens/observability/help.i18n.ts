// Words of the help panels of the Observability screen (help.tsx): for every section, what is measured, how it is
// computed, how to read it and where the rule comes from. Each text mirrors the server code that computes the section
// (core queries/execution-facts.ts, calibration.ts, test-history.ts, harness-health.ts, attention.ts,
// harness-containment.ts and harness/containment.ts, check.ts, escapes.ts). A line break inside a text starts a new item.
// A source is only named when the code cites it; the rest is «convención nuestra» or «decisión de la persona».

import { messages } from '../../i18n/define.ts';

export const HELP_TOPICS = ['containment', 'escapes', 'attempts', 'cost', 'rework', 'calibration', 'tests', 'agents', 'jev', 'health', 'checks', 'versions', 'attention', 'worth'] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

export const OBS_HELP = messages(
  {
    button: (section: string) => `Help: ${section}`,
    whatLabel: 'What it measures',
    howLabel: 'How it is computed',
    readLabel: 'How to read it',
    sourceLabel: 'Source',
    description: (section: string) => `What the section «${section}» measures, how, and where the rule comes from.`,

    containmentMeasures:
      'For each design phase (P1 to P7), how many of the errors that were introduced in that phase were caught in the same phase, and how many slipped through to a later one. The measure is called phase containment effectiveness (PCE).',
    containmentHow:
      'PCE of a phase = errors caught in the phase that introduced them / (those + errors that escaped it).\nOnly rows the escape rule marked as contained count as contained, so the measure cannot be padded with unmarked confirmations.\nIt counts defects, not rows: rows of the same phase with the same defect key are one defect, and if any of them escaped, the defect escaped.\nAn error belongs to the phase where it was introduced, so a late discovery lowers the past: each point of the trend is recomputed from every stored escape introduced up to the end of that check window, however late it was found.\nData: the stored escapes of one escape-rules version (the latest one). The bars use every stored escape; the trend has one point per stored check (up to 30).',
    containmentRead:
      'The target is 90 % per phase: a bar at or above it is green, below it is red, and the marker on the bar shows the target.\nA phase with fewer than 10 defects (contained + escaped) reads «not enough data», not a percentage.\nThe contained and the escaped rows are listed side by side in the details so you can audit them.',
    containmentSource:
      'Formula: Daskalantonakis 1992 (Motorola) and Kan, «Metrics and Models in Software Quality Engineering», chapter «Defect Removal Effectiveness» (chapter number not checked; the formula is quoted from memory).\nThe 90 % target: decisión de la persona (01-10); no standard fixes it.\nThe minimum of 10 defects, counting per defect and showing the contained rows for audit: convención nuestra.',

    escapesMeasures:
      'The problems that design did not see and that building, review or the person found later. Each one is stored as an «escape» with the phase that should have seen it and the phase that found it.',
    escapesHow:
      'Deterministic rules (E01 to E17; E14 is pending because the data it needs is not stored) read the stored facts. No model is called.\nThe same escape is never written twice for the same rules version.\nThe chart on top compares errors contained and escaped, per defect, as in phase containment; the bars by rule count the stored escapes of each rule (rows, not defects).\nWindow: every stored escape of the latest escape-rules version.',
    escapesRead:
      'Fewer escapes is better, and an escape that is found early is cheaper than one found while building.\nThe rule name says what the design missed; the code in front of it is the rule that detected it.\nThere is no target for the number of escapes: the target is on phase containment.',
    escapesSource:
      'The idea of containment comes from Daskalantonakis 1992 (Motorola) and Kan, «Defect Removal Effectiveness» (chapter number not checked).\nThe rules and the phase each one blames are convención nuestra, written in code under a rules version.',

    attemptsMeasures:
      'What happened to each try of the builder (an attempt) on a build request: merged, sent back with changes requested, failed, or still open. It also shows how many attempts a task needs and where the time of each attempt goes.',
    attemptsHow:
      'Every attempt is one fact, derived on read from the build steps, the reviews and the agent usage; nothing is stored apart.\nAttempts per merged task = all attempts / tasks merged.\nThe time of an attempt is split into builder, CI and review (each is the union of its stage segments, so overlaps count once) and wait, which is the rest of its wall time.\nContext recall = of the files the attempt changed, the share the builder had been given. Issues later = issues opened against the task after it merged.\nSizes are the task\'s current sizes, not those when the attempt ran. Window: every attempt of the project.',
    attemptsRead:
      'A lower number of attempts per merged task means less rework; 1.0 would be everything merged at the first attempt.\nThere is no target in the code: compare it with your own earlier numbers.\nThe grey part of the bar is attempts still running, cancelled or open.',
    attemptsSource:
      'Splitting an attempt into builder, CI, review and wait, and counting every attempt, is convención nuestra.',

    costMeasures:
      'What the builds cost in tokens and dollars, per task and per feature, and how the cost per task changes over time.',
    costHow:
      'Cost of a task = declared cost of the builder and the reviewer over all its attempts. Tokens = input + output tokens (cached and reasoning tokens are subsets of those).\nThe cost is only what the provider declared; it is never estimated. Tasks with no declared cost are left out of the totals and the line, and a note says how many attempts had no usage.\nFeature cost adds the tasks of the feature. The overview number is the sum over tasks; the delta compares the mean of the latest 5 tasks with the 5 before, and appears only from 10 tasks.\nWindow: every attempt of the project.',
    costRead:
      'Lower is better for the same work. Look at the line: a task far above the others usually had several attempts (see Rework).\nThe delta is tinted red above +10 % and green below -10 %; those cuts are a screen convention, not a standard.\nA total that looks low may only mean that many attempts reported no cost.',
    costSource: 'Grouping the cost per task and per feature, and the token total, are convención nuestra.',

    reworkMeasures:
      'How much of the builder\'s work had to be redone: attempts that came back with changes requested or that failed, and why.',
    reworkHow:
      'Share of attempts redone = (attempts with changes requested + failed attempts) / all attempts.\nWhy changes were requested: Jev\'s category of each blocking comment of the reviewer («unclassified» while Jev has not said).\nWhy an attempt failed: the recorded failure kind, or the stage that failed.\nWindow: every attempt of the project.',
    reworkRead:
      'A lower share is better. The two groups mean different things: changes requested is the review working, a failure is the process breaking.\nThe most frequent cause is the first thing to look at. There is no target in the code.',
    reworkSource: 'The way rework is counted and grouped is convención nuestra.',

    calibrationMeasures:
      'Whether the size Jev gives a task predicts how long it takes to merge.',
    calibrationHow:
      'Each bar is the median lead time of the merged tasks of that size: from the first start of the build request to its merge (the attempt that merged). Medians are used because lead times are skewed.\nThe reading line is the rank correlation between size points (XS 1, S 2, M 3, L 5, XL 8) and lead time, over merged tasks that have a size.\nWith fewer than 8 tasks it says there are too few to read.\nWindow: every merged task of the project.',
    calibrationRead:
      'Longer bars for bigger sizes mean the size predicts the time.\nBy the correlation (absolute value): below 0.3 weak, below 0.6 moderate, 0.6 or more strong; positive means the bigger the size, the longer it takes.\nIt is a rule of thumb for a sober reading, not a significance test.',
    calibrationSource:
      'Lead time for changes follows the DORA definition (Forsgren, Humble and Kim, «Accelerate», 2018). The rank correlation is Spearman\'s (1904) with average ranks for ties.\nThe size points, the 0.3 and 0.6 cuts and the minimum of 8 tasks are convención nuestra.',

    testsMeasures:
      'The slowest tests and the flaky ones (those whose result changes without a code change), from the CI test results DEMIURGO keeps.',
    testsHow:
      'Every CI test result is kept per test and commit (skipped results count as nothing). The chart shows the 6 tests with the highest median duration; the details list up to 25.\nA test is flaky when, on the same commit, it both passed and failed.\nWindow: the latest 300,000 stored results.',
    testsRead:
      'Slow tests make every attempt longer, because CI runs them each time. A flaky test makes a red result untrustworthy: it can send a good attempt back.\nThere is no threshold in the code; compare tests with each other.',
    testsSource:
      'Flaky definition: Google Testing Blog, «Flaky Tests at Google and How We Mitigate Them» (2016); Martin Fowler, «Eradicating Non-Determinism in Tests». Medians, the cap on rows and the list lengths are convención nuestra.',

    agentsMeasures:
      'How many times each agent ran, how often it failed and what it cost, including the builder.',
    agentsHow:
      'Runs come from the recorded agent runs plus the builder (the builder is not an agent run, so it is counted from the attempts that had builder work).\nA run failed when its state is failed or it has a failure kind; the builder fails when the attempt failed at the builder stage.\nCost and tokens are what the provider declared. Duration is the median in seconds.\nThe cost bars show the 10 agents that cost most. Window: every run of the project.',
    agentsRead:
      'Look for an agent with many failures or a cost out of proportion to its runs. A missing cost means the provider declared none, not that it was free.\nThere is no target in the code.',
    agentsSource: 'Grouping by agent, provider and model is convención nuestra.',

    jevMeasures:
      'Whether Jev\'s judgments on tasks held up against what happened: the size it gave and the files it predicted.',
    jevHow:
      'Size: Jev\'s size is compared with the builder time of the merged build. The size bands are cut at the quantiles of the builder minutes of all merged builds, with as many bands as sizes in use; «in band» counts builds whose time fell in the band of Jev\'s size.\nConfidence: builds are grouped by Jev\'s confidence (below 0.6, 0.6 to 0.75, 0.75 or more) and the accuracy of each group is shown; the expected calibration error is the mean gap between accuracy and confidence, weighted by group size. The details also give the Brier score (0 is perfect).\nFiles: a file counts as predicted when Jev\'s probability is at least 0.5. Precision = of the predicted files, those the pull request changed; recall = of the changed files, those predicted; the medians over builds are shown.\nOnly the latest opinion of each task is judged. Window: every merged task.',
    jevRead:
      'Bars near 100 % in band mean the size is a good guide to the time. Accuracy close to confidence means Jev knows when it is unsure; a lower error is better (0 would be perfect).\nHigh file precision means few wasted files; high recall means few missed ones.\nThere are no targets in the code, and with few builds the numbers move a lot.',
    jevSource:
      'Reliability table and expected calibration error: Guo, Pleiss, Sun and Weinberger, «On Calibration of Modern Neural Networks» (ICML 2017); here a coarse 3-group version. Brier score: Brier, «Verification of forecasts expressed in terms of probability» (Monthly Weather Review, 1950). Rank correlation: Spearman (1904).\nThe size bands, the confidence groups, the 0.5 file threshold and builder minutes as the ground truth are convención nuestra.',

    healthMeasures:
      'Whether each piece of the harness (the checks and rules DEMIURGO applies while building) helps, is neutral or gets in the way, judged by what really happened after its decisions.',
    healthHow:
      'After a build request ends, a deterministic post-mortem classifies what each piece decided: true positive, false positive, false negative or true negative (plus cost and benefit rows). No model is called.\nPrecision = TP / (TP + FP); recall = TP / (TP + FN). They are computed per rule, never mixed across the rules of a piece, and the piece takes the verdict of its worst rule.\nThe chart counts pieces by verdict. It reads the latest post-mortem of every request under the latest rules version, with no date cut, and for each piece only the engine cohort of its newest finding.',
    healthRead:
      'No data: fewer than 10 decisions, or no measure with 10 cases behind it.\nGets in the way: precision below 0.5, or harmful misses (a failure on main or a later issue) in 20 % or more of the cases the rule let through.\nHelps: precision at least 0.7 and recall at least 0.5, and the benefit is greater than the cost in the units they share. Neutral: everything else. Cost alone never makes a piece get in the way.',
    healthSource:
      'The post-mortem is blameless in the sense of the Google SRE book, «Postmortem Culture»: it records what each piece decided and cost, not whose fault it was.\nThe cuts (0.7, 0.5, 0.5, 20 % and 10 decisions) are convención nuestra: no standard fixes them (scikit-learn defines precision and recall, not their cuts).',

    checksMeasures:
      'The periodic check of the harness: did anything get worse since the previous check, and how many new escapes appeared.',
    checksHow:
      'A deterministic job recomputes the scorecards over the last 7 days and stores the result. It runs every 24 hours or after 5 merged tasks since the last check, whichever comes first, and no model is called.\nIt compares with the previous check and lists regressions: a piece whose verdict got worse, a phase whose containment fell by more than 0.2 (from 5 items on), and a cost per merged task (USD or tokens) up by more than 25 %.\nTwo checks are compared only under the same rules; after a rules change the first check starts afresh.\nNew escapes are those recorded since the previous check. The line shows the regressions of each stored check.',
    checksRead:
      'No regressions is the normal state. A regression is a prompt to look, not a verdict: open the piece, phase or cost it names.\nRegressions are about DEMIURGO, not the product, so they never become an issue of the project.',
    checksSource:
      'The window, the schedule and the thresholds are convención nuestra: no standard fixes them (the Scrum Guide 2020 only says the retrospective closes each sprint, at most one month).',

    versionsMeasures:
      'How many builds ran under each version of the harness, and how the scorecards looked in each.',
    versionsHow:
      'A harness version is one content hash of the DEMIURGO commit, the fingerprints of the agents and skills, the versions of the questions put to Jev and the post-mortem rules version. Each build request is tagged with the version in force.\nA cohort is the builds that have a post-mortem under one version; the bar is its number of builds, named by the short commit. Builds from before versions existed are «untagged».\nWindow: all post-mortems of the latest rules version.',
    versionsRead:
      'These are observational cohorts, not an experiment: nothing was assigned at random. A cohort that overlaps in time with no other is labelled «observational, not comparable».\nA difference between versions is a lead to investigate, not proof that a change worked.',
    versionsSource:
      'The label of a comparison that is not an experiment follows Kohavi, Tang and Xu, «Trustworthy Online Controlled Experiments». What makes a version is convención nuestra.',

    attentionMeasures:
      'How much of the person\'s time each design stage takes, as a proxy: the minutes in which the person did something in that stage.',
    attentionHow:
      'The minutes come from the journal: 5-minute buckets that hold at least one event of the person, times 5. A stage takes the buckets with events of that stage, so stages overlap and do not add up to the total.\nThe stage of a question is the one that raised it; a proposal belongs to the kind of record it creates.\nThe details also give questions, proposals and batches per stage (a batch is «accepted whole» with at least 5 items, all accepted and none edited), seconds per item, and tokens and USD per artefact.\nWindow: the whole history of the project. No model is called.',
    attentionRead:
      'It is a lower bound, not a measure of attention: time spent thinking without acting leaves no event.\nA long bar is not bad by itself; compare it with what the stage produced.',
    attentionSource:
      'All of it is convención nuestra: no standard fixes the stages, the whole-batch rule, the 5-minute buckets or the 15-minute gap that closes a session.',

    worthMeasures:
      'What one merged task costs: dollars, tokens and person minutes, to judge whether the whole process is worth it.',
    worthHow:
      'Cost = declared usage of design runs, reviewer runs and builder steps. Tokens = input + output; USD only when the provider declared it.\nPer merged task = total / tasks with a build request done. Person minutes = the 5-minute buckets with an event of the person, times 5, over the whole project.\nIt shows «—» when no task has merged. The details also give CI minutes, verified criteria and approved records.\nWindow: the whole history of the project.',
    worthRead:
      'Lower is better for the same output, and the useful comparison is with the same project earlier on; the harness checks flag a rise of more than 25 % in USD or tokens per task.\nUnits are cost over value; no single number sums them up.',
    worthSource:
      'Unit economics, as the code puts it: «FinOps: total attributed cost over units delivered». The unit «verified criterion» and the person-minutes proxy are convención nuestra.',
  },
  {
    button: (section: string) => `Ayuda: ${section}`,
    whatLabel: 'Qué mide',
    howLabel: 'Cómo se calcula',
    readLabel: 'Cómo leerlo',
    sourceLabel: 'Fuente',
    description: (section: string) => `Qué mide la sección «${section}», cómo, y de dónde sale la regla.`,

    containmentMeasures:
      'Para cada fase del diseño (P1 a P7), cuántos de los errores introducidos en esa fase se cazaron en la misma fase y cuántos se escaparon a una posterior. La medida se llama efectividad de contención de fase (PCE, por sus siglas en inglés).',
    containmentHow:
      'PCE de una fase = errores cazados en la fase que los introdujo / (esos + errores que se le escaparon).\nSolo cuentan como contenidas las filas que la regla de fuga marcó como contenidas, así que la medida no se puede inflar con confirmaciones sin marcar.\nCuenta defectos, no filas: las filas de la misma fase con la misma clave de defecto son un solo defecto, y si alguna se escapó, el defecto se escapó.\nUn error pertenece a la fase donde se introdujo, así que un hallazgo tardío rebaja el pasado: cada punto de la tendencia se recalcula con todas las fugas guardadas introducidas hasta el final de esa ventana de chequeo, por tarde que se encontraran.\nDatos: las fugas guardadas de una versión de reglas de fugas (la última). Las barras usan todas las fugas guardadas; la tendencia tiene un punto por chequeo guardado (hasta 30).',
    containmentRead:
      'El objetivo es el 90 % por fase: una barra en el objetivo o por encima es verde, por debajo es roja, y la marca de la barra muestra el objetivo.\nUna fase con menos de 10 defectos (contenidos + escapados) dice «datos insuficientes», no un porcentaje.\nLas filas contenidas y las escapadas se listan juntas en el detalle para que puedas auditarlas.',
    containmentSource:
      'Fórmula: Daskalantonakis 1992 (Motorola) y Kan, «Metrics and Models in Software Quality Engineering», capítulo «Defect Removal Effectiveness» (número de capítulo sin comprobar; la fórmula está citada de memoria).\nEl objetivo del 90 %: decisión de la persona (01-10); ningún estándar lo fija.\nEl mínimo de 10 defectos, contar por defecto y mostrar las filas contenidas para auditar: convención nuestra.',

    escapesMeasures:
      'Los problemas que el diseño no vio y que la construcción, la revisión o la persona encontraron después. Cada uno se guarda como una «fuga» con la fase que debió verlo y la fase que lo encontró.',
    escapesHow:
      'Reglas deterministas (E01 a E17; E14 está pendiente porque no se guardan los datos que necesita) leen los hechos guardados. No se llama a ningún modelo.\nLa misma fuga no se escribe dos veces para la misma versión de reglas.\nLa gráfica de arriba compara errores contenidos y escapados, por defecto, como en la contención de fase; las barras por regla cuentan las fugas guardadas de cada regla (filas, no defectos).\nVentana: todas las fugas guardadas de la última versión de reglas de fugas.',
    escapesRead:
      'Menos fugas es mejor, y una fuga hallada pronto sale más barata que una hallada construyendo.\nEl nombre de la regla dice qué se le escapó al diseño; el código delante es la regla que lo detectó.\nNo hay objetivo para el número de fugas: el objetivo está en la contención de fase.',
    escapesSource:
      'La idea de contención viene de Daskalantonakis 1992 (Motorola) y Kan, «Defect Removal Effectiveness» (número de capítulo sin comprobar).\nLas reglas y la fase que culpa cada una son convención nuestra, escritas en código bajo una versión de reglas.',

    attemptsMeasures:
      'Qué pasó con cada intento del constructor sobre una petición de construcción: fusionado, devuelto con cambios pedidos, fallido o aún abierto. También muestra cuántos intentos necesita una tarea y adónde va el tiempo de cada uno.',
    attemptsHow:
      'Cada intento es un hecho, derivado al leer de los pasos de construcción, las revisiones y el uso de los agentes; nada se guarda aparte.\nIntentos por tarea fusionada = todos los intentos / tareas fusionadas.\nEl tiempo de un intento se reparte en constructor, CI y revisión (cada uno es la unión de los tramos de su etapa, así que los solapes cuentan una vez) y espera, que es el resto de su tiempo total.\nRecall del contexto = de los ficheros que cambió el intento, la parte que se le había dado al constructor. Incidencias después = incidencias abiertas contra la tarea después de fusionarla.\nLos tamaños son los actuales de la tarea, no los de cuando corrió el intento. Ventana: todos los intentos del proyecto.',
    attemptsRead:
      'Menos intentos por tarea fusionada significa menos repetición; 1,0 sería todo fusionado al primer intento.\nEl código no fija un objetivo: compáralo con tus números anteriores.\nLa parte gris de la barra son intentos en curso, cancelados o abiertos.',
    attemptsSource:
      'Repartir un intento en constructor, CI, revisión y espera, y contar todos los intentos, es convención nuestra.',

    costMeasures:
      'Lo que cuestan las construcciones en tokens y dólares, por tarea y por funcionalidad, y cómo cambia el coste por tarea con el tiempo.',
    costHow:
      'Coste de una tarea = coste declarado del constructor y del revisor en todos sus intentos. Tokens = tokens de entrada + salida (los de caché y razonamiento son subconjuntos de esos).\nEl coste es solo el que declaró el proveedor; nunca se estima. Las tareas sin coste declarado quedan fuera de los totales y de la línea, y una nota dice cuántos intentos no traían uso.\nEl coste de una funcionalidad suma sus tareas. El número del resumen es la suma de las tareas; la variación compara la media de las últimas 5 tareas con las 5 anteriores y solo aparece desde 10 tareas.\nVentana: todos los intentos del proyecto.',
    costRead:
      'Menos es mejor para el mismo trabajo. Mira la línea: una tarea muy por encima de las demás suele haber tenido varios intentos (mira Repetición).\nLa variación se tiñe de rojo por encima de +10 % y de verde por debajo de -10 %; esos cortes son una convención de la pantalla, no un estándar.\nUn total bajo puede significar solo que muchos intentos no informaron de coste.',
    costSource: 'Agrupar el coste por tarea y por funcionalidad, y el total de tokens, es convención nuestra.',

    reworkMeasures:
      'Cuánto del trabajo del constructor hubo que rehacer: intentos que volvieron con cambios pedidos o que fallaron, y por qué.',
    reworkHow:
      'Parte de intentos repetidos = (intentos con cambios pedidos + intentos fallidos) / todos los intentos.\nPor qué se pidieron cambios: la categoría que Jev da a cada comentario bloqueante del revisor («sin clasificar» mientras Jev no lo diga).\nPor qué falló un intento: el tipo de fallo registrado o la etapa que falló.\nVentana: todos los intentos del proyecto.',
    reworkRead:
      'Una parte menor es mejor. Los dos grupos significan cosas distintas: los cambios pedidos son la revisión funcionando; un fallo es el proceso rompiéndose.\nLa causa más frecuente es lo primero que mirar. El código no fija un objetivo.',
    reworkSource: 'La forma de contar y agrupar la repetición es convención nuestra.',

    calibrationMeasures:
      '¿Predice el tamaño que Jev da a una tarea cuánto tarda en fusionarse?',
    calibrationHow:
      'Cada barra es el tiempo de entrega mediano de las tareas fusionadas de ese tamaño: desde el primer arranque de la petición de construcción hasta su fusión (el intento que fusionó). Se usan medianas porque los tiempos de entrega son asimétricos.\nLa línea de lectura es la correlación de rangos entre los puntos de tamaño (XS 1, S 2, M 3, L 5, XL 8) y el tiempo de entrega, sobre las tareas fusionadas que tienen tamaño.\nCon menos de 8 tareas dice que son pocas para leer.\nVentana: todas las tareas fusionadas del proyecto.',
    calibrationRead:
      'Barras más largas para tamaños mayores significan que el tamaño predice el tiempo.\nPor la correlación (valor absoluto): por debajo de 0,3 débil, por debajo de 0,6 moderada, 0,6 o más fuerte; positiva significa que a mayor tamaño, más tarda.\nEs una regla práctica para una lectura sobria, no una prueba de significación.',
    calibrationSource:
      'El tiempo de entrega de los cambios sigue la definición de DORA (Forsgren, Humble y Kim, «Accelerate», 2018). La correlación de rangos es la de Spearman (1904), con rangos medios para los empates.\nLos puntos de tamaño, los cortes 0,3 y 0,6 y el mínimo de 8 tareas son convención nuestra.',

    testsMeasures:
      'Las pruebas más lentas y las inestables (las que cambian de resultado sin cambio de código), a partir de los resultados de pruebas de CI que DEMIURGO guarda.',
    testsHow:
      'Cada resultado de prueba de CI se guarda por prueba y commit (los resultados omitidos no cuentan). La gráfica muestra las 6 pruebas con mayor duración mediana; el detalle lista hasta 25.\nUna prueba es inestable cuando, en el mismo commit, pasó y falló.\nVentana: los últimos 300.000 resultados guardados.',
    testsRead:
      'Las pruebas lentas alargan cada intento, porque CI las ejecuta cada vez. Una prueba inestable quita fiabilidad a un resultado rojo: puede devolver un buen intento.\nEl código no tiene umbral; compara las pruebas entre sí.',
    testsSource:
      'Definición de inestable: Google Testing Blog, «Flaky Tests at Google and How We Mitigate Them» (2016); Martin Fowler, «Eradicating Non-Determinism in Tests». Las medianas, el tope de filas y la longitud de las listas son convención nuestra.',

    agentsMeasures:
      'Cuántas veces corrió cada agente, cuántas veces falló y cuánto costó, incluido el constructor.',
    agentsHow:
      'Las ejecuciones salen de las ejecuciones de agentes registradas más el constructor (el constructor no es una ejecución de agente, así que se cuenta desde los intentos con trabajo del constructor).\nUna ejecución falló cuando su estado es fallido o tiene un tipo de fallo; el constructor falla cuando el intento falló en la etapa del constructor.\nCoste y tokens son los que declaró el proveedor. La duración es la mediana en segundos.\nLas barras de coste muestran los 10 agentes que más costaron. Ventana: todas las ejecuciones del proyecto.',
    agentsRead:
      'Busca un agente con muchos fallos o un coste desproporcionado para sus ejecuciones. Un coste ausente significa que el proveedor no declaró ninguno, no que fuera gratis.\nEl código no fija un objetivo.',
    agentsSource: 'Agrupar por agente, proveedor y modelo es convención nuestra.',

    jevMeasures:
      'Si los juicios de Jev sobre las tareas se sostuvieron frente a lo que pasó: el tamaño que dio y los ficheros que predijo.',
    jevHow:
      'Tamaño: el tamaño de Jev se compara con el tiempo del constructor de la construcción fusionada. Las bandas de tamaño se cortan en los cuantiles de los minutos del constructor de todas las construcciones fusionadas, con tantas bandas como tamaños en uso; «en banda» cuenta las construcciones cuyo tiempo cayó en la banda del tamaño de Jev.\nConfianza: las construcciones se agrupan por la confianza de Jev (menos de 0,6, de 0,6 a 0,75, 0,75 o más) y se muestra el acierto de cada grupo; el error de calibración esperado es la diferencia media entre acierto y confianza, ponderada por el tamaño del grupo. El detalle da también la puntuación de Brier (0 es perfecto).\nFicheros: un fichero cuenta como predicho cuando la probabilidad de Jev es al menos 0,5. Precisión = de los ficheros predichos, los que cambió la pull request; recall = de los ficheros cambiados, los predichos; se muestran las medianas sobre las construcciones.\nSolo se juzga la última opinión de cada tarea. Ventana: todas las tareas fusionadas.',
    jevRead:
      'Barras cerca del 100 % en banda significan que el tamaño es buena guía del tiempo. Un acierto cercano a la confianza significa que Jev sabe cuándo duda; un error menor es mejor (0 sería perfecto).\nUna precisión alta de ficheros significa pocos ficheros de más; un recall alto, pocos que faltan.\nEl código no fija objetivos, y con pocas construcciones los números se mueven mucho.',
    jevSource:
      'Tabla de fiabilidad y error de calibración esperado: Guo, Pleiss, Sun y Weinberger, «On Calibration of Modern Neural Networks» (ICML 2017); aquí una versión gruesa de 3 grupos. Puntuación de Brier: Brier, «Verification of forecasts expressed in terms of probability» (Monthly Weather Review, 1950). Correlación de rangos: Spearman (1904).\nLas bandas de tamaño, los grupos de confianza, el umbral de 0,5 para ficheros y los minutos del constructor como verdad de referencia son convención nuestra.',

    healthMeasures:
      'Si cada pieza del harness (las comprobaciones y reglas que DEMIURGO aplica al construir) ayuda, es neutra o estorba, juzgado por lo que de verdad pasó después de sus decisiones.',
    healthHow:
      'Cuando termina una petición de construcción, un post-mortem determinista clasifica lo que decidió cada pieza: verdadero positivo, falso positivo, falso negativo o verdadero negativo (más filas de coste y de beneficio). No se llama a ningún modelo.\nPrecisión = TP / (TP + FP); recall = TP / (TP + FN). Se calculan por regla, nunca mezcladas entre las reglas de una pieza, y la pieza toma el veredicto de su peor regla.\nLa gráfica cuenta piezas por veredicto. Lee el último post-mortem de cada petición bajo la última versión de reglas, sin corte de fechas, y de cada pieza solo la cohorte de motor de su hallazgo más reciente.',
    healthRead:
      'Sin datos: menos de 10 decisiones, o ninguna medida con 10 casos detrás.\nEstorba: precisión por debajo de 0,5, o fallos perjudiciales (un fallo en main o una incidencia posterior) en el 20 % o más de los casos que la regla dejó pasar.\nAyuda: precisión de al menos 0,7 y recall de al menos 0,5, y el beneficio mayor que el coste en las unidades que comparten. Neutra: todo lo demás. El coste solo nunca hace que una pieza estorbe.',
    healthSource:
      'El post-mortem es sin culpables en el sentido del libro de Google SRE, «Postmortem Culture»: registra qué decidió y costó cada pieza, no de quién fue la culpa.\nLos cortes (0,7, 0,5, 0,5, 20 % y 10 decisiones) son convención nuestra: ningún estándar los fija (scikit-learn define precisión y recall, no sus cortes).',

    checksMeasures:
      'El chequeo periódico del harness: si algo empeoró desde el chequeo anterior y cuántas fugas nuevas aparecieron.',
    checksHow:
      'Un trabajo determinista recalcula las tarjetas de las piezas sobre los últimos 7 días y guarda el resultado. Corre cada 24 horas o tras 5 tareas fusionadas desde el último chequeo, lo que ocurra antes, y no se llama a ningún modelo.\nCompara con el chequeo anterior y lista las regresiones: una pieza cuyo veredicto empeoró, una fase cuya contención cayó más de 0,2 (desde 5 elementos) y un coste por tarea fusionada (USD o tokens) que sube más del 25 %.\nDos chequeos se comparan solo bajo las mismas reglas; tras un cambio de reglas el primer chequeo empieza de cero.\nLas fugas nuevas son las registradas desde el chequeo anterior. La línea muestra las regresiones de cada chequeo guardado.',
    checksRead:
      'Sin regresiones es el estado normal. Una regresión es un aviso para mirar, no un veredicto: abre la pieza, la fase o el coste que nombra.\nLas regresiones son de DEMIURGO, no del producto, así que nunca se convierten en una incidencia del proyecto.',
    checksSource:
      'La ventana, la frecuencia y los umbrales son convención nuestra: ningún estándar los fija (la Guía de Scrum 2020 solo dice que la retrospectiva cierra cada sprint, de un mes como máximo).',

    versionsMeasures:
      'Cuántas construcciones corrieron bajo cada versión del harness y cómo eran las tarjetas en cada una.',
    versionsHow:
      'Una versión del harness es un hash del contenido del commit de DEMIURGO, las huellas de los agentes y las skills, las versiones de las preguntas que se hacen a Jev y la versión de reglas del post-mortem. Cada petición de construcción lleva la versión vigente.\nUna cohorte son las construcciones con post-mortem bajo una versión; la barra es su número de construcciones, nombrada por el commit corto. Las de antes de que existieran versiones son «sin etiquetar».\nVentana: todos los post-mortems de la última versión de reglas.',
    versionsRead:
      'Son cohortes observacionales, no un experimento: nada se asignó al azar. Una cohorte que no coincide en el tiempo con ninguna otra se etiqueta «observacional, no comparable».\nUna diferencia entre versiones es una pista que investigar, no prueba de que un cambio funcionara.',
    versionsSource:
      'La etiqueta de una comparación que no es un experimento sigue a Kohavi, Tang y Xu, «Trustworthy Online Controlled Experiments». Qué forma una versión es convención nuestra.',

    attentionMeasures:
      'Cuánto tiempo de la persona consume cada etapa del diseño, como indicador indirecto: los minutos en que la persona hizo algo en esa etapa.',
    attentionHow:
      'Los minutos salen del diario: tramos de 5 minutos que contienen al menos un evento de la persona, por 5. Una etapa toma los tramos con eventos de esa etapa, así que las etapas se solapan y no suman el total.\nLa etapa de una pregunta es la que la planteó; una propuesta pertenece al tipo de registro que crea.\nEl detalle da además preguntas, propuestas y lotes por etapa (un lote está «aceptado entero» con al menos 5 elementos, todos aceptados y ninguno editado), segundos por elemento, y tokens y USD por artefacto.\nVentana: todo el historial del proyecto. No se llama a ningún modelo.',
    attentionRead:
      'Es una cota inferior, no una medida de atención: pensar sin actuar no deja evento.\nUna barra larga no es mala por sí misma; compárala con lo que produjo la etapa.',
    attentionSource:
      'Todo es convención nuestra: ningún estándar fija las etapas, la regla de lote entero, los tramos de 5 minutos ni el hueco de 15 minutos que cierra una sesión.',

    worthMeasures:
      'Lo que cuesta una tarea fusionada: dólares, tokens y minutos de la persona, para juzgar si el proceso entero compensa.',
    worthHow:
      'Coste = uso declarado de las ejecuciones de diseño, las del revisor y los pasos del constructor. Tokens = entrada + salida; USD solo cuando el proveedor lo declaró.\nPor tarea fusionada = total / tareas con una petición de construcción terminada. Minutos de la persona = los tramos de 5 minutos con un evento de la persona, por 5, en todo el proyecto.\nMuestra «—» cuando ninguna tarea se ha fusionado. El detalle da además minutos de CI, criterios verificados y registros aprobados.\nVentana: todo el historial del proyecto.',
    worthRead:
      'Menos es mejor para la misma producción, y la comparación útil es con el mismo proyecto antes; los chequeos del harness avisan de una subida de más del 25 % en USD o tokens por tarea.\nLas unidades son coste entre valor; ningún número único las resume.',
    worthSource:
      'Economía por unidad, como lo dice el código: «FinOps: coste total atribuido entre unidades entregadas». La unidad «criterio verificado» y el indicador de minutos de la persona son convención nuestra.',
  },
);

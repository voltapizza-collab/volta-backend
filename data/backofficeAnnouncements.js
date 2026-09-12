// Add a user-facing note in the same change that delivers a feature.
// Keep IDs stable; increase revision only when users need to read the note again.
export const backofficeAnnouncements = [
  {
    id: "pos-pause-queue-2026-09", revision: 1,
    publishedAt: "2026-09-12T16:00:00.000Z", expiresAt: "2026-12-12T16:00:00.000Z",
    category: "improvement", severity: "info", title: "La pausa del POS web ocupa toda la pantalla de pedidos",
    message: "Al pausar las operaciones en el POS web, la cola y los tickets quedan ocultos aunque haya pedidos programados. Pulsa Reanudar operaciones para volver a verlos; los pedidos se conservan.",
    translations: {
      en: { title: "Web POS pause fills the order screen", message: "When operations are paused in the web POS, the queue and tickets stay hidden even if there are scheduled orders. Select Resume operations to see them again; your orders are preserved." },
      it: { title: "La pausa del POS web occupa tutta la schermata degli ordini", message: "Quando metti in pausa le operazioni nel POS web, la coda e i ticket restano nascosti anche se ci sono ordini programmati. Premi Riprendi operazioni per rivederli; gli ordini vengono conservati." },
      fr: { title: "La pause du POS web occupe tout l’écran des commandes", message: "Lorsque les opérations sont en pause dans le POS web, la file et les tickets restent masqués même si des commandes sont programmées. Appuyez sur Reprendre les opérations pour les retrouver ; vos commandes sont conservées." },
      pt: { title: "A pausa do POS web ocupa todo o ecrã de pedidos", message: "Ao pausar as operações no POS web, a fila e os tickets ficam ocultos mesmo que existam pedidos agendados. Prima Retomar operações para os voltar a ver; os pedidos são preservados." },
    },
  },
  {
    id: "inventory-ingredient-details-2026-09", revision: 1,
    publishedAt: "2026-09-12T00:00:00.000Z", expiresAt: "2026-12-12T00:00:00.000Z",
    category: "improvement", severity: "info", title: "Una ficha de ingredientes más clara",
    message: "El precio base, la descripción y la foto de tus ingredientes se guardan para tu negocio. Los alias y alérgenos muestran la referencia del catálogo global, y la ausencia de información ya no se presenta como ausencia de alérgenos.",
    detail: "Usar un precio sugerido solo rellena la ficha abierta. Las traducciones y su revisión se consultan en la sección de identidad. Las tarjetas del inventario ajustan los nombres largos y muestran alérgenos y precio en filas separadas.",
    translations: {
      en: { title: "Clearer ingredient details", message: "Ingredient base prices, descriptions and photos are saved for your business. Aliases and allergens show the global catalog reference; missing information is no longer presented as an absence of allergens.", detail: "Using a suggested price only fills in the open form. Translations and their review status are available in the identity section. Inventory cards wrap long names and display allergens and price on separate rows." },
      it: { title: "Schede ingredienti più chiare", message: "Prezzi base, descrizioni e foto degli ingredienti vengono salvati per la tua attività. Alias e allergeni mostrano il riferimento del catalogo globale; i dati mancanti non vengono più presentati come assenza di allergeni.", detail: "Il prezzo suggerito compila soltanto la scheda aperta. Traduzioni e stato della revisione sono nella sezione identità. Le schede dell’inventario adattano i nomi lunghi e mostrano allergeni e prezzo su righe separate." },
      fr: { title: "Des fiches ingrédients plus claires", message: "Les prix de base, descriptions et photos sont enregistrés pour votre entreprise. Les alias et allergènes affichent la référence du catalogue global ; les données manquantes ne sont plus présentées comme une absence d’allergènes.", detail: "Le prix suggéré remplit uniquement la fiche ouverte. Les traductions et leur état de vérification figurent dans la section identité. Les cartes de l’inventaire adaptent les noms longs et affichent les allergènes et le prix sur des lignes séparées." },
      pt: { title: "Fichas de ingredientes mais claras", message: "Os preços base, descrições e fotos são guardados para o seu negócio. Os nomes alternativos e alergénios mostram a referência do catálogo global; dados em falta já não são apresentados como ausência de alergénios.", detail: "O preço sugerido preenche apenas a ficha aberta. As traduções e o estado da revisão estão na secção de identidade. Os cartões do inventário ajustam os nomes longos e mostram alergénios e preço em linhas separadas." },
    },
  },
  {
    id: "backoffice-notifications-2026-09",
    revision: 1,
    publishedAt: "2026-09-12T00:00:00.000Z",
    expiresAt: "2026-12-12T00:00:00.000Z",
    category: "improvement",
    severity: "info",
    title: "Lo importante, a primera vista",
    message: "Volta ahora te avisa al entrar si quedan pocos SMS o hay una mejora que debes conocer. Puedes volver a consultar los mensajes desde Avisos, en el menú lateral.",
    detail: "Los avisos de saldo siguen pendientes hasta que recargues. Las novedades dejan de abrirse cuando las marcas como leídas.",
    translations: {
      en: {
        title: "What matters, at a glance",
        message: "Volta now lets you know when you sign in if you're low on SMS or there's an improvement to discover. You can revisit messages under Notifications in the sidebar.",
        detail: "Balance alerts stay pending until you top up. Product updates stop opening automatically once you mark them as read.",
      },
      it: {
        title: "Quello che conta, a colpo d'occhio",
        message: "Volta ora ti avvisa all'accesso se rimangono pochi SMS o c'è una novità da scoprire. Puoi rileggere i messaggi da Notifiche nel menu laterale.",
        detail: "Gli avvisi sul saldo restano in sospeso fino alla ricarica. Le novità non si aprono più automaticamente dopo che le segni come lette.",
      },
      fr: {
        title: "L'essentiel, en un coup d'œil",
        message: "Volta vous avertit désormais à la connexion si votre solde SMS est faible ou si une amélioration vous attend. Retrouvez les messages dans Notifications, dans le menu latéral.",
        detail: "Les alertes de solde restent en attente jusqu'à la recharge. Les nouveautés ne s'ouvrent plus automatiquement une fois marquées comme lues.",
      },
      pt: {
        title: "O essencial, num relance",
        message: "A Volta avisa agora ao entrar se restam poucos SMS ou há uma melhoria para descobrir. Pode voltar a consultar as mensagens em Notificações, no menu lateral.",
        detail: "Os alertas de saldo ficam pendentes até carregar. As novidades deixam de abrir automaticamente quando as marca como lidas.",
      },
    },
  },
  {
    id: "backoffice-notifications-language-2026-09",
    revision: 1,
    publishedAt: "2026-09-12T08:00:00.000Z",
    expiresAt: "2026-12-12T00:00:00.000Z",
    category: "improvement",
    severity: "info",
    title: "Tus avisos, en tu idioma",
    message: "Las notificaciones siguen el idioma que elijas en el backoffice. Además, las alertas de SMS siguen comprobando tu saldo aunque las novedades no estén disponibles temporalmente.",
    translations: {
      en: { title: "Your notifications, in your language", message: "Notifications follow the language you choose in the backoffice. SMS alerts also keep checking your balance even when product updates are temporarily unavailable." },
      it: { title: "Le notifiche, nella tua lingua", message: "Le notifiche seguono la lingua scelta nel backoffice. Gli avvisi SMS continuano a verificare il saldo anche quando le novità sono temporaneamente non disponibili." },
      fr: { title: "Vos notifications, dans votre langue", message: "Les notifications suivent la langue choisie dans le backoffice. Les alertes SMS continuent à vérifier votre solde même lorsque les nouveautés sont temporairement indisponibles." },
      pt: { title: "As notificações, no seu idioma", message: "As notificações seguem o idioma escolhido no backoffice. Os alertas de SMS continuam a verificar o saldo mesmo quando as novidades estão temporariamente indisponíveis." },
    },
  },
];

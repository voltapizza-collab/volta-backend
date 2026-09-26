// Add a user-facing note in the same change that delivers a feature.
// Keep IDs stable; increase revision only when users need to read the note again.
// Draft: add to backofficeAnnouncements and set publication dates only after the
// matching storefront is available. This export alone does not enter the feed.
export const ingredientDiscoveryAnnouncementDraft = {
  id: "ingredient-discovery-options-2026-09", revision: 1,
  category: "improvement", severity: "info",
  title: "Más ayuda al buscar ingredientes",
  message: "En Global Manager, buscar entrecot o aceitunas verdes muestra una opción documentada de la lista maestra y explica su alcance: entrecot de lomo alto o aceituna Gordal. Revisa la explicación antes de elegir la ficha.",
  translations: {
    en: { title: "More help when searching for ingredients", message: "In Global Manager, searching for entrecot or aceitunas verdes shows a documented option from the master list and explains its scope: ribeye or Gordal olives. Read the explanation before choosing the record." },
    it: { title: "Più aiuto nella ricerca degli ingredienti", message: "In Global Manager, cercando entrecot o aceitunas verdes viene mostrata un’opzione documentata della lista principale con il suo ambito: ribeye oppure olive Gordal. Leggi la spiegazione prima di scegliere la scheda." },
    fr: { title: "Plus d’aide pour rechercher des ingrédients", message: "Dans Global Manager, une recherche de entrecot ou aceitunas verdes affiche une option documentée de la liste principale et précise sa portée : ribeye ou olives Gordal. Lisez l’explication avant de choisir la fiche." },
    pt: { title: "Mais ajuda na pesquisa de ingredientes", message: "No Global Manager, pesquisar entrecot ou aceitunas verdes apresenta uma opção documentada da lista principal e explica o seu âmbito: ribeye ou azeitonas Gordal. Leia a explicação antes de escolher a ficha." },
  },
};

export const inventoryLoadRecoveryAnnouncementDraft = {
  id: "inventory-load-recovery-2026-09", revision: 1,
  category: "improvement", severity: "info",
  title: "Estado de conexión del inventario",
  message: "El inventario avisa mientras carga y muestra un botón Reintentar si falla la conexión, para que puedas recuperar la lista desde la misma pantalla.",
  translations: {
    en: { title: "Inventory connection status", message: "Inventory shows when it is loading and offers a Retry button if the connection fails, so you can recover the list from the same screen." },
    it: { title: "Stato della connessione dell’inventario", message: "L’inventario indica il caricamento e mostra il pulsante Riprova se la connessione non riesce, per recuperare l’elenco dalla stessa schermata." },
    fr: { title: "État de connexion de l’inventaire", message: "L’inventaire indique le chargement et affiche un bouton Réessayer si la connexion échoue, pour retrouver la liste depuis le même écran." },
    pt: { title: "Estado da ligação do inventário", message: "O inventário indica quando está a carregar e mostra o botão Tentar novamente se a ligação falhar, para recuperar a lista no mesmo ecrã." },
  },
};

export const ingredientRestaurantTaxonomyAnnouncementDraft = {
  id: "ingredient-restaurant-families-2026-09", revision: 1,
  category: "improvement", severity: "info",
  title: "Ingredientes organizados para toda tu cocina",
  message: "El catálogo y el inventario se organizan en 14 familias. Ahora puedes encontrar panes, masas, pastas, cereales, lácteos y proteínas vegetales en sus propios grupos, además de los ingredientes habituales de tus pizzas.",
  detail: "Usa las categorías o busca por nombre para encontrar un ingrediente. Tus recetas, existencias y precios se conservan.",
  translations: {
    en: { title: "Ingredients organized for your whole kitchen", message: "The catalogue and inventory are organized into 14 families. Find bread, dough, pasta, grains, dairy and plant proteins in their own groups, alongside your usual pizza ingredients.", detail: "Use the categories or search by name to find an ingredient. Your recipes, stock and prices are preserved." },
    it: { title: "Ingredienti organizzati per tutta la tua cucina", message: "Il catalogo e l’inventario sono organizzati in 14 famiglie. Pane, impasti, pasta, cereali, latticini e proteine vegetali hanno ora i propri gruppi, accanto ai consueti ingredienti delle tue pizze.", detail: "Usa le categorie o cerca per nome per trovare un ingrediente. Ricette, scorte e prezzi restano invariati." },
    fr: { title: "Des ingrédients organisés pour toute votre cuisine", message: "Le catalogue et l’inventaire sont organisés en 14 familles. Retrouvez pains, pâtes à pain, pâtes alimentaires, céréales, produits laitiers et protéines végétales dans leurs propres groupes, aux côtés de vos ingrédients de pizza habituels.", detail: "Utilisez les catégories ou recherchez par nom pour trouver un ingrédient. Vos recettes, stocks et prix sont conservés." },
    pt: { title: "Ingredientes organizados para toda a sua cozinha", message: "O catálogo e o inventário estão organizados em 14 famílias. Pães, massas de pão, massas alimentícias, cereais, laticínios e proteínas vegetais têm agora os seus próprios grupos, além dos ingredientes habituais das suas pizzas.", detail: "Use as categorias ou pesquise pelo nome para encontrar um ingrediente. As suas receitas, existências e preços são preservados." },
  },
};

export const productSpecialNoticesAnnouncement = {
  id: "product-special-notices-2026-09", revision: 1, publishedAt: "2026-09-17T11:45:22.456Z", expiresAt: "2026-12-17T11:45:22.465Z",
  category: "improvement", severity: "info",
  title: "Más avisos especiales para tus platos",
  message: "En Avisos especiales de Pizza Creator puedes combinar Picante, Vegano, Vegetariano, Sin gluten, Kosher y Halal. En la carta comparten una etiqueta que alterna el texto verticalmente y cambia de color; la ficha del plato muestra todos juntos.",
  detail: "En móvil y escritorio, los avisos sobre la imagen se reservan para platos sin otra etiqueta: Top Deal, Trending y Próximo tienen prioridad. La ficha del plato conserva todos los avisos especiales. Los contadores de las ofertas quedan a la derecha debajo de la foto.",
  translations: {
    en: { title: "More special notices for your dishes", message: "Under Special notices in Pizza Creator, you can combine Spicy, Vegan, Vegetarian, Gluten-free, Kosher and Halal. The menu uses one label that cycles vertically through the notices and changes colour; the product details show them all together.", detail: "On mobile and desktop, notices over the image are reserved for dishes without another label: Top Deal, Trending and Upcoming take priority. The product details keep all special notices. Offer countdowns stay on the right below the photo." },
    it: { title: "Più avvisi speciali per i tuoi piatti", message: "In Avvisi speciali di Pizza Creator puoi combinare Piccante, Vegano, Vegetariano, Senza glutine, Kosher e Halal. Nel menu condividono un’etichetta che alterna il testo verticalmente e cambia colore; la scheda del piatto li mostra tutti insieme.", detail: "Su mobile e desktop, gli avvisi sull’immagine sono riservati ai piatti senza altre etichette: Top Deal, Trending e Prossimamente hanno la precedenza. La scheda del piatto conserva tutti gli avvisi speciali. I conti alla rovescia delle offerte restano a destra sotto la foto." },
    fr: { title: "Plus de mentions spéciales pour vos plats", message: "Dans Mentions spéciales de Pizza Creator, vous pouvez combiner Épicé, Végan, Végétarien, Sans gluten, Casher et Halal. Le menu utilise une seule étiquette qui fait défiler les mentions verticalement et change de couleur ; la fiche du plat les présente toutes ensemble.", detail: "Sur mobile et ordinateur, les mentions sur l’image sont réservées aux plats sans autre étiquette : Top Deal, Trending et À venir sont prioritaires. La fiche du plat conserve toutes les mentions spéciales. Les comptes à rebours des offres restent à droite sous la photo." },
    pt: { title: "Mais avisos especiais para os seus pratos", message: "Em Avisos especiais do Pizza Creator pode combinar Picante, Vegano, Vegetariano, Sem glúten, Kosher e Halal. Na ementa partilham uma etiqueta que alterna o texto verticalmente e muda de cor; a ficha do prato apresenta todos juntos.", detail: "No telemóvel e no computador, os avisos sobre a imagem ficam reservados aos pratos sem outra etiqueta: Top Deal, Trending e Em breve têm prioridade. A ficha do prato conserva todos os avisos especiais. As contagens decrescentes das ofertas ficam à direita por baixo da fotografia." },
  },
};

export const ingredientAvailableBadgeAnnouncement = {
  id: "inventory-available-badge-2026-09", revision: 1, publishedAt: "2026-09-17T11:45:22.456Z", expiresAt: "2026-12-17T11:45:22.465Z",
  category: "improvement", severity: "info",
  title: "Ingredientes disponibles más fáciles de distinguir",
  message: "La etiqueta Agregar tiene fondo amarillo y letras moradas. Identifica los ingredientes disponibles que todavía no has añadido a tu tienda, tanto en las categorías como en la búsqueda.",
  translations: {
    en: { title: "Available ingredients are easier to identify", message: "The Agregar label now has a yellow background and purple text. It identifies available ingredients you have not yet added to your store, in both categories and search results." },
    it: { title: "Ingredienti disponibili più facili da riconoscere", message: "L’etichetta Agregar ha uno sfondo giallo e un testo viola. Identifica gli ingredienti disponibili che non hai ancora aggiunto al negozio, nelle categorie e nei risultati di ricerca." },
    fr: { title: "Les ingrédients disponibles sont plus faciles à repérer", message: "L’étiquette Agregar a un fond jaune et un texte violet. Elle identifie les ingrédients disponibles que vous n’avez pas encore ajoutés à votre établissement, dans les catégories et les résultats de recherche." },
    pt: { title: "Ingredientes disponíveis mais fáceis de distinguir", message: "A etiqueta Agregar tem fundo amarelo e letras roxas. Identifica os ingredientes disponíveis que ainda não adicionou à sua loja, nas categorias e nos resultados da pesquisa." },
  },
};

export const notificationInboxAnnouncement = {
  id: "backoffice-notification-inbox-2026-09", revision: 1, publishedAt: "2026-09-17T11:45:22.456Z", expiresAt: "2026-12-17T11:45:22.465Z",
  category: "improvement", severity: "info",
  title: "Tus avisos, uno a uno",
  message: "Cada aviso aparece solo. Al marcarlo como leído, pasas al siguiente; al terminar todas las novedades aparece el botón Historial para volver a consultarlas. Si cierras antes, abre Avisos para continuar con lo que falta por leer.",
  detail: "El historial conserva los 10 avisos leídos más recientes en este navegador para tu negocio. Los anteriores siguen marcados como leídos. Las alertas de saldo SMS siguen pendientes mientras necesiten atención.",
  translations: {
    en: { title: "Your notifications, one at a time", message: "Each notification appears on its own. Marking it as read takes you to the next one; once you have read all updates, the History button appears so you can revisit them. If you close early, open Notifications to continue with unread updates.", detail: "History keeps the 10 most recent read notifications in this browser for your business. Older notifications remain marked as read. SMS balance alerts stay pending while they need attention." },
    it: { title: "Le tue notifiche, una alla volta", message: "Ogni notifica appare da sola. Segnandola come letta passi alla successiva; dopo aver letto tutte le novità appare il pulsante Cronologia per rileggerle. Se chiudi prima, apri Notifiche per continuare con quelle ancora da leggere.", detail: "La cronologia conserva le 10 notifiche lette più recenti in questo browser per la tua attività. Quelle precedenti restano contrassegnate come lette. Gli avvisi sul saldo SMS restano in sospeso finché richiedono attenzione." },
    fr: { title: "Vos notifications, une à la fois", message: "Chaque notification apparaît seule. La marquer comme lue vous fait passer à la suivante ; une fois toutes les nouveautés lues, le bouton Historique apparaît pour les consulter à nouveau. Si vous fermez avant la fin, ouvrez Notifications pour reprendre la lecture.", detail: "L’historique conserve les 10 notifications lues les plus récentes dans ce navigateur pour votre établissement. Les anciennes restent marquées comme lues. Les alertes de solde SMS restent en attente tant qu’elles nécessitent une intervention." },
    pt: { title: "As suas notificações, uma de cada vez", message: "Cada notificação aparece sozinha. Ao marcá-la como lida passa à seguinte; depois de ler todas as novidades aparece o botão Histórico para voltar a consultá-las. Se fechar antes, abra Notificações para continuar com as que faltam ler.", detail: "O histórico conserva as 10 notificações lidas mais recentes neste navegador para o seu negócio. As anteriores continuam marcadas como lidas. Os alertas de saldo SMS continuam pendentes enquanto precisarem de atenção." },
  },
};

export const ingredientCatalogEditorAnnouncement = {
  id: "ingredient-catalog-editor-2026-09", revision: 1, publishedAt: "2026-09-17T11:45:22.456Z", expiresAt: "2026-12-17T11:45:22.465Z",
  category: "improvement", severity: "info",
  title: "Editar y recuperar ingredientes desde una sola ficha",
  message: "En Global Manager, Editar reúne nombres, idiomas y foto. Eliminar del panel devuelve el ingrediente a la bolsa general y conserva su ficha para recuperarla. Si está en uso, la retirada se bloquea.",
  detail: "La lista maestra se conserva. Uso global indica las tiendas activas que tienen habilitado el ingrediente; no mide ventas.",
  translations: {
    en: { title: "Edit and restore ingredients in one form", message: "In Global Manager, Edit brings names, languages and the photo together. Removing an ingredient from the panel returns it to the general pool and preserves its record for restoration. Ingredients in use cannot be removed.", detail: "The master list is preserved. Global usage shows the active stores where the ingredient is enabled; it does not measure sales." },
    it: { title: "Modificare e recuperare ingredienti in un’unica scheda", message: "In Global Manager, Modifica riunisce nomi, lingue e foto. Rimuovere un ingrediente dal pannello lo restituisce al catalogo generale conservandone la scheda per recuperarla. Gli ingredienti in uso non possono essere rimossi.", detail: "La lista principale viene conservata. Uso globale indica i negozi attivi in cui l’ingrediente è abilitato; non misura le vendite." },
    fr: { title: "Modifier et récupérer les ingrédients dans une seule fiche", message: "Dans Global Manager, Modifier regroupe les noms, les langues et la photo. Retirer un ingrédient du panneau le renvoie dans la réserve générale en conservant sa fiche pour le récupérer. Les ingrédients utilisés ne peuvent pas être retirés.", detail: "La liste principale est conservée. Utilisation globale indique les établissements actifs où l’ingrédient est activé ; elle ne mesure pas les ventes." },
    pt: { title: "Editar e recuperar ingredientes numa única ficha", message: "No Global Manager, Editar reúne nomes, idiomas e fotografia. Retirar um ingrediente do painel devolve-o ao catálogo geral e conserva a ficha para o recuperar. Os ingredientes em uso não podem ser retirados.", detail: "A lista principal é conservada. Uso global indica as lojas ativas onde o ingrediente está habilitado; não mede vendas." },
  },
};

export const posPaymentReceiptAnnouncement = {
  id: "pos-payment-receipt-2026-09", revision: 1, publishedAt: "2026-09-17T11:45:22.456Z", expiresAt: "2026-12-17T11:45:22.465Z",
  category: "improvement", severity: "info",
  title: "Estado del pago más claro en el ticket",
  message: "Los pedidos cobrados con tarjeta muestran Tarjeta pagada. Efectivo pendiente queda reservado para los pedidos en efectivo que siguen por cobrar; el efectivo confirmado muestra Efectivo cobrado.",
  detail: "La pantalla y el ticket usan el mismo estado. En SUNMI, esta mejora requiere actualizar la app a la versión 0.3.9.",
  translations: {
    en: { title: "Clearer payment status on receipts", message: "Orders paid by card show Tarjeta pagada. Efectivo pendiente is reserved for cash orders that still need to be collected; confirmed cash payments show Efectivo cobrado.", detail: "The screen and receipt use the same status. On SUNMI, this improvement requires app version 0.3.9." },
    it: { title: "Stato del pagamento più chiaro sullo scontrino", message: "Gli ordini pagati con carta mostrano Tarjeta pagada. Efectivo pendiente è riservato agli ordini in contanti ancora da incassare; i pagamenti in contanti confermati mostrano Efectivo cobrado.", detail: "Schermata e scontrino usano lo stesso stato. Su SUNMI, questa miglioria richiede la versione 0.3.9 dell’app." },
    fr: { title: "Un état du paiement plus clair sur le ticket", message: "Les commandes réglées par carte affichent Tarjeta pagada. Efectivo pendiente est réservé aux commandes en espèces restant à encaisser ; les paiements en espèces confirmés affichent Efectivo cobrado.", detail: "L’écran et le ticket utilisent le même état. Sur SUNMI, cette amélioration nécessite la version 0.3.9 de l’application." },
    pt: { title: "Estado do pagamento mais claro no talão", message: "Os pedidos pagos com cartão mostram Tarjeta pagada. Efectivo pendiente fica reservado aos pedidos em dinheiro ainda por cobrar; os pagamentos em dinheiro confirmados mostram Efectivo cobrado.", detail: "O ecrã e o talão usam o mesmo estado. No SUNMI, esta melhoria requer a versão 0.3.9 da aplicação." },
  },
};

export const ingredientRemovalAnnouncement = {
  id: "pizza-ingredient-removals-2026-09",
  revision: 1,
  publishedAt: "2026-09-16T09:06:22.000Z",
  expiresAt: "2026-12-16T09:06:22.000Z",
  category: "improvement",
  severity: "info",
  title: "Pizzas con ingredientes a elección",
  message: "Tus clientes pueden quitar ingredientes de las pizzas enteras de carta. El desplegable lee automáticamente los ingredientes guardados en la receta, igual que la descripción, sin tener que activarlos uno a uno.",
  detail: "El precio se mantiene. Las retiradas se pueden editar en el carrito y se conservan al repetir un pedido. Cocina y ticket agrupan retiradas y extras bajo CAMBIOS en cada pizza; si no hay modificaciones, muestran Receta original. El SUNMI requiere la app 0.3.8. Las mitades y las pizzas de promociones quedan para una próxima fase.",
  translations: {
    en: { title: "Let customers leave ingredients out", message: "Customers can remove ingredients from whole menu pizzas. The dropdown automatically reads the ingredients saved in the recipe, just like the description, without enabling them one by one.", detail: "The price stays the same. Removals can be edited in the cart and are kept when repeating an order. Kitchen and receipt group removals and extras under CAMBIOS for each pizza; unchanged pizzas show Receta original. SUNMI requires app 0.3.8. Half pizzas and pizzas in promotions will follow in a later phase." },
    it: { title: "Pizze con ingredienti a scelta", message: "I clienti possono togliere ingredienti dalle pizze intere del menu. Il menu a discesa legge automaticamente gli ingredienti salvati nella ricetta, come la descrizione, senza doverli attivare uno per uno.", detail: "Il prezzo non cambia. Le rimozioni sono modificabili nel carrello e vengono conservate ripetendo l’ordine. Cucina e scontrino raggruppano rimozioni ed extra sotto CAMBIOS per ogni pizza; senza modifiche appare Receta original. SUNMI richiede l’app 0.3.8. Le mezze pizze e le pizze nelle promozioni arriveranno in una fase successiva." },
    fr: { title: "Des pizzas avec les ingrédients au choix", message: "Les clients peuvent retirer des ingrédients des pizzas entières de la carte. La liste déroulante lit automatiquement les ingrédients enregistrés dans la recette, comme la description, sans devoir les activer un par un.", detail: "Le prix reste identique. Les retraits sont modifiables dans le panier et conservés lors d’une nouvelle commande identique. La cuisine et le ticket regroupent retraits et suppléments sous CAMBIOS pour chaque pizza ; sans modification, Receta original s’affiche. SUNMI nécessite l’app 0.3.8. Les demi-pizzas et les pizzas des promotions suivront dans une prochaine phase." },
    pt: { title: "Pizzas com ingredientes à escolha", message: "Os clientes podem retirar ingredientes das pizzas inteiras da ementa. A lista lê automaticamente os ingredientes guardados na receita, tal como a descrição, sem ser necessário ativá-los um a um.", detail: "O preço mantém-se. As retiradas podem ser editadas no carrinho e são conservadas ao repetir o pedido. Cozinha e talão agrupam retiradas e extras sob CAMBIOS em cada pizza; sem alterações, aparece Receta original. O SUNMI requer a app 0.3.8. As metades e as pizzas de promoções ficam para uma fase posterior." },
  },
};

export const backofficeAnnouncements = [
  productSpecialNoticesAnnouncement,
  ingredientAvailableBadgeAnnouncement,
  notificationInboxAnnouncement,
  ingredientCatalogEditorAnnouncement,
  posPaymentReceiptAnnouncement,
  ingredientRemovalAnnouncement,
  {
    id: "ingredient-translation-flow-2026-09", revision: 1,
    publishedAt: "2026-09-12T17:00:00.000Z", expiresAt: "2026-12-12T17:00:00.000Z",
    category: "improvement", severity: "info", title: "Un solo proceso para los idiomas de ingredientes",
    message: "En Global Manager, añadir un ingrediente confirma sus siete nombres. La ficha de semántica muestra los idiomas guardados y señala los que faltan; puedes completar una ficha antigua y confirmar sus nombres al guardar.",
    translations: {
      en: { title: "One process for ingredient languages", message: "In Global Manager, adding an ingredient confirms its seven names. The semantics panel shows saved languages and highlights missing ones; you can complete an older ingredient and confirm its names when saving." },
      it: { title: "Un unico processo per le lingue degli ingredienti", message: "In Global Manager, aggiungere un ingrediente conferma i suoi sette nomi. La scheda semantica mostra le lingue salvate e segnala quelle mancanti; puoi completare un ingrediente precedente e confermarne i nomi al salvataggio." },
      fr: { title: "Un seul processus pour les langues des ingrédients", message: "Dans Global Manager, l’ajout d’un ingrédient confirme ses sept noms. La fiche sémantique affiche les langues enregistrées et signale celles qui manquent ; vous pouvez compléter un ancien ingrédient et confirmer ses noms en enregistrant." },
      pt: { title: "Um único processo para os idiomas dos ingredientes", message: "No Global Manager, adicionar um ingrediente confirma os seus sete nomes. A ficha de semântica mostra os idiomas guardados e assinala os que faltam; pode completar um ingrediente antigo e confirmar os nomes ao guardar." },
    },
  },
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
// Publish only after the coordinated backend and storefront release.
export const checkoutAvailabilityAnnouncementDraft = {
  id: "checkout-ingredient-availability-2026-09", revision: 1,
  category: "maintenance", severity: "info",
  title: "Disponibilidad comprobada antes de confirmar pedidos",
  message: "Al desactivar un ingrediente en el inventario o en el POS, se comprueba su disponibilidad antes de crear nuevos pedidos. La carta abierta se actualiza automáticamente y el cliente conserva su carrito si debe revisarlo.",
  translations: {
    en: { title: "Availability checked before confirming orders", message: "When an ingredient is disabled in inventory or the POS, its availability is checked before new orders are created. Open menus refresh automatically, and customers keep their cart if it needs reviewing." },
    it: { title: "Disponibilità verificata prima di confermare gli ordini", message: "Quando un ingrediente viene disattivato nell’inventario o nel POS, la sua disponibilità viene verificata prima di creare nuovi ordini. Il menu aperto si aggiorna automaticamente e il cliente conserva il carrello se deve rivederlo." },
    fr: { title: "Disponibilité vérifiée avant de confirmer les commandes", message: "Lorsqu’un ingrédient est désactivé dans l’inventaire ou le POS, sa disponibilité est vérifiée avant la création de nouvelles commandes. Le menu ouvert se met à jour automatiquement et le client conserve son panier s’il doit le vérifier." },
    pt: { title: "Disponibilidade verificada antes de confirmar pedidos", message: "Quando um ingrediente é desativado no inventário ou no POS, a sua disponibilidade é verificada antes de criar novos pedidos. A ementa aberta atualiza-se automaticamente e o cliente mantém o carrinho caso tenha de o rever." },
  },
};

// Publish only with the coordinated backend/storefront release, after Sunmi QA.
export const checkoutPricingAnnouncementDraft = {
  id: "checkout-pricing-validation-2026-09", revision: 1,
  category: "improvement", severity: "info",
  title: "Precios y ofertas comprobados al confirmar el pedido",
  message: "El pedido comprueba los precios de productos y extras y las condiciones de promociones y regalos. Si algo cambia, el cliente conserva su carrito y ve qué artículo debe revisar. Los extras desactivados dejan de ofrecerse en esa tienda.",
  translations: {
    en: { title: "Prices and offers checked when confirming an order", message: "Orders check product and extra prices and the conditions of promotions and rewards. If something changes, customers keep their cart and see which item needs reviewing. Disabled extras are no longer offered at that store." },
    it: { title: "Prezzi e offerte verificati alla conferma dell’ordine", message: "L’ordine verifica i prezzi dei prodotti e degli extra e le condizioni di promozioni e omaggi. Se qualcosa cambia, il cliente conserva il carrello e vede quale articolo deve controllare. Gli extra disattivati non vengono più offerti in quel negozio." },
    fr: { title: "Prix et offres vérifiés à la confirmation de la commande", message: "La commande vérifie les prix des produits et des suppléments ainsi que les conditions des promotions et des cadeaux. En cas de changement, le client conserve son panier et voit quel article vérifier. Les suppléments désactivés ne sont plus proposés dans ce magasin." },
    pt: { title: "Preços e ofertas verificados ao confirmar o pedido", message: "O pedido verifica os preços dos produtos e extras e as condições das promoções e ofertas. Se algo mudar, o cliente mantém o carrinho e vê que artigo deve rever. Os extras desativados deixam de ser disponibilizados nessa loja." },
  },
};

// Draft only: publish together with checkout, storefront and the updated POS.
export const checkoutDeliveryAnnouncementDraft = {
  id:"checkout-delivery-validation-2026-09",revision:1,category:"improvement",severity:"info",
  title:"Reparto revisado antes de confirmar el pedido",
  message:"La tarifa variable se comprueba con la dirección y la ruta en el servidor. Si cambia el coste, el cliente revisa el total antes de confirmar. Cuando se aplica la tarifa base por falta de ruta, el POS y los tickets indican que hay que confirmar el reparto con el cliente.",
  translations:{
    en:{title:"Delivery checked before confirming an order",message:"Variable delivery fees are checked using the address and route on the server. If the cost changes, customers review the total before confirming. When the base fee applies because no route is available, the POS and receipts indicate that delivery must be confirmed with the customer."},
    it:{title:"Consegna verificata prima di confermare l’ordine",message:"La tariffa variabile viene verificata tramite indirizzo e percorso sul server. Se il costo cambia, il cliente controlla il totale prima di confermare. Quando si applica la tariffa base perché il percorso non è disponibile, POS e scontrini indicano di confermare la consegna con il cliente."},
    fr:{title:"Livraison vérifiée avant la confirmation de la commande",message:"Le tarif variable est vérifié à partir de l’adresse et de l’itinéraire sur le serveur. Si le coût change, le client vérifie le total avant de confirmer. Lorsque le tarif de base s’applique faute d’itinéraire, le POS et les tickets indiquent de confirmer la livraison avec le client."},
    pt:{title:"Entrega verificada antes de confirmar o pedido",message:"A tarifa variável é verificada com o endereço e a rota no servidor. Se o custo mudar, o cliente revê o total antes de confirmar. Quando se aplica a tarifa base por falta de rota, o POS e os talões indicam que é necessário confirmar a entrega com o cliente."},
  },
};

// Draft: activate only with the corresponding POS/web rollout; one USB terminal is not a general release.
export const posCategoryAlignmentAnnouncementDraft = {
  id: 'pos-category-alignment-2026-09', revision: 1, category: 'improvement', severity: 'info',
  title: 'Categorías más legibles en el POS',
  message: 'Los nombres largos del inventario se muestran alineados a la izquierda en varias líneas, con los contadores separados a la derecha. Disponible en SUNMI desde la app 0.3.11.',
  translations: {
    en: { title: 'Clearer POS categories', message: 'Long inventory category names wrap onto left-aligned lines, with counts kept separately on the right. Available on SUNMI from app version 0.3.11.' },
    it: { title: 'Categorie più leggibili nel POS', message: 'I nomi lunghi delle categorie sono allineati a sinistra su più righe, con i conteggi separati a destra. Disponibile su SUNMI dalla versione 0.3.11.' },
    fr: { title: 'Catégories plus lisibles dans le POS', message: 'Les noms longs des catégories passent sur plusieurs lignes alignées à gauche, avec les compteurs séparés à droite. Disponible sur SUNMI à partir de la version 0.3.11.' },
    pt: { title: 'Categorias mais legíveis no POS', message: 'Os nomes longos das categorias aparecem em várias linhas alinhadas à esquerda, com os contadores separados à direita. Disponível no SUNMI a partir da versão 0.3.11.' },
  },
};

// Add a user-facing note in the same change that delivers a feature.
// Draft until 0.3.20 reaches the intended terminals.
export const posDailyUpdatesAnnouncementDraft = {
  id: "pos-daily-updates-2026-10", revision: 1, category: "improvement", severity: "info",
  title: "Actualizaciones con menos interrupciones",
  message: "Volta busca versiones al abrirse y una vez al día si permanece abierta. El recordatorio aparece como máximo una vez al día. Al actualizar, programar o dejar pendiente, el cartel se cierra al guardar tu elección; una programación vigente se conserva sin volver a pedir confirmación.",
  translations: {
    en: { title: "Updates with fewer interruptions", message: "Volta checks for versions when opened and once a day if it stays open. Reminders appear at most once a day. Updating, scheduling or leaving an update pending closes the dialog once your choice is saved; an active schedule is kept without asking for confirmation again." },
    it: { title: "Aggiornamenti con meno interruzioni", message: "Volta cerca nuove versioni all’apertura e una volta al giorno se resta aperta. Il promemoria appare al massimo una volta al giorno. Aggiornare, programmare o lasciare in sospeso chiude il dialogo dopo il salvataggio della scelta; una programmazione valida viene conservata senza chiedere nuovamente conferma." },
    fr: { title: "Des mises à jour avec moins d’interruptions", message: "Volta recherche de nouvelles versions à l’ouverture et une fois par jour si elle reste ouverte. Le rappel apparaît au maximum une fois par jour. Mettre à jour, programmer ou laisser en attente ferme le dialogue après enregistrement du choix ; une programmation valide est conservée sans redemander confirmation." },
    pt: { title: "Atualizações com menos interrupções", message: "A Volta procura versões ao abrir e uma vez por dia se permanecer aberta. O lembrete aparece no máximo uma vez por dia. Atualizar, agendar ou deixar pendente fecha o diálogo após guardar a escolha; um agendamento válido é mantido sem pedir nova confirmação." },
  },
};
// Draft until 0.3.19 is available to the intended terminals.
export const posVersionNumberAnnouncementDraft = {
  id: "pos-version-number-2026-10", revision: 1, category: "improvement", severity: "info",
  title: "Una versión más fácil de identificar",
  message: "El POS muestra solo el número de versión, sin el sufijo técnico de conexión. Las actualizaciones siguen llegando por internet con conexión segura. Si la instalación te devuelve al escritorio, abre Volta desde su icono.",
  translations: {
    en: { title: "An easier version to identify", message: "The POS shows only the version number, without the technical connection suffix. Updates still arrive over a secure internet connection. If installation returns you to the home screen, open Volta from its icon." },
    it: { title: "Una versione più facile da identificare", message: "Il POS mostra solo il numero di versione, senza il suffisso tecnico della connessione. Gli aggiornamenti continuano ad arrivare tramite una connessione internet sicura. Se l’installazione ti riporta alla schermata iniziale, apri Volta dalla sua icona." },
    fr: { title: "Une version plus facile à identifier", message: "Le POS affiche uniquement le numéro de version, sans le suffixe technique de connexion. Les mises à jour continuent d’arriver par une connexion internet sécurisée. Si l’installation vous ramène à l’écran d’accueil, ouvrez Volta depuis son icône." },
    pt: { title: "Uma versão mais fácil de identificar", message: "O POS mostra apenas o número da versão, sem o sufixo técnico de ligação. As atualizações continuam a chegar por uma ligação segura à internet. Se a instalação voltar ao ecrã inicial, abra a Volta pelo seu ícone." },
  },
};
// Draft until the updated APK is distributed to the intended terminals.
export const posUpdateActionsAnnouncementDraft = {
  id: "pos-update-actions-2026-10", revision: 1, category: "improvement", severity: "info",
  title: "Un aviso de actualización más sencillo",
  message: "El cartel del POS muestra las opciones Actualizar ahora y Ahora no. Desde Ahora no puedes programar la instalación o dejarla pendiente. El terminal sigue buscando nuevas versiones automáticamente.",
  translations: {
    en: { title: "A simpler update notice", message: "The POS update dialog shows Update now and Not now. From Not now, you can schedule the installation or leave it pending. The terminal continues checking for new versions automatically." },
    it: { title: "Un avviso di aggiornamento più semplice", message: "Il dialogo del POS mostra Aggiorna ora e Non ora. Da Non ora puoi programmare l’installazione o lasciarla in sospeso. Il terminale continua a cercare nuove versioni automaticamente." },
    fr: { title: "Un avis de mise à jour plus simple", message: "Le dialogue du POS affiche Mettre à jour maintenant et Pas maintenant. Depuis Pas maintenant, vous pouvez programmer l’installation ou la laisser en attente. Le terminal continue de rechercher automatiquement de nouvelles versions." },
    pt: { title: "Um aviso de atualização mais simples", message: "O diálogo do POS mostra Atualizar agora e Agora não. Em Agora não, pode agendar a instalação ou deixá-la pendente. O terminal continua a procurar novas versões automaticamente." },
  },
};
// Draft until the permanent service and a migrated terminal are verified together.
export const posPermanentUpdatesAnnouncementDraft = {
  id: "pos-permanent-updates-2026-10", revision: 1, category: "improvement", severity: "info",
  title: "Actualizaciones del POS por internet",
  message: "El terminal consulta el servicio permanente de Volta y avisa cuando tiene una nueva versión asignada. Revisa sus novedades y elige cuándo instalarla; las siguientes actualizaciones no necesitan cable USB.",
  detail: "La comprobación se realiza con Volta abierto. Los terminales de prueba anteriores necesitan una primera migración al canal permanente. La aplicación se reinicia durante la instalación y conserva sus datos.",
  translations: {
    en: { title: "POS updates over the internet", message: "The terminal checks Volta’s permanent service and notifies you when a new version is assigned. Read its release notes and choose when to install; subsequent updates do not need a USB cable.", detail: "Checks run while Volta is open. Earlier test terminals need an initial migration to the permanent channel. The app restarts during installation and keeps its data." },
    it: { title: "Aggiornamenti POS via internet", message: "Il terminale consulta il servizio permanente di Volta e segnala le nuove versioni assegnate. Leggi le novità e scegli quando installare; gli aggiornamenti successivi non richiedono un cavo USB.", detail: "I controlli avvengono con Volta aperto. I terminali di prova precedenti richiedono una migrazione iniziale al canale permanente. L’app si riavvia durante l’installazione e conserva i dati." },
    fr: { title: "Mises à jour du POS par internet", message: "Le terminal consulte le service permanent de Volta et signale toute nouvelle version qui lui est attribuée. Consultez les nouveautés et choisissez quand l’installer ; les mises à jour suivantes ne nécessitent pas de câble USB.", detail: "Les vérifications ont lieu lorsque Volta est ouvert. Les anciens terminaux de test nécessitent une migration initiale vers le canal permanent. L’application redémarre pendant l’installation et conserve ses données." },
    pt: { title: "Atualizações do POS pela internet", message: "O terminal consulta o serviço permanente da Volta e avisa quando lhe é atribuída uma nova versão. Leia as novidades e escolha quando instalar; as atualizações seguintes não precisam de cabo USB.", detail: "As verificações ocorrem com a Volta aberta. Os terminais de teste anteriores precisam de uma migração inicial para o canal permanente. A aplicação reinicia durante a instalação e conserva os dados." },
  },
};
// Draft: publish with the APK that displays its installed version in the footer.
export const posVersionFooterAnnouncementDraft = {
  id: "pos-version-footer-2026-10", revision: 1, category: "improvement", severity: "info",
  title: "La versión de tu POS, a la vista",
  message: "El pie del terminal muestra la versión realmente instalada. Puedes comprobar de un vistazo qué versión tienes después de actualizar.",
  translations: {
    en: { title: "Your POS version at a glance", message: "The terminal footer shows the version actually installed. You can check your version at a glance after updating." },
    it: { title: "La versione del tuo POS, sempre visibile", message: "Il piè di pagina del terminale mostra la versione effettivamente installata. Dopo un aggiornamento puoi controllarla a colpo d’occhio." },
    fr: { title: "La version de votre POS en un coup d’œil", message: "Le pied de page du terminal affiche la version réellement installée. Vous pouvez la vérifier en un coup d’œil après une mise à jour." },
    pt: { title: "A versão do seu POS à vista", message: "O rodapé do terminal mostra a versão realmente instalada. Pode verificar a sua versão de relance após atualizar." },
  },
};
// Draft: keep outside the feed until the update channel is available to recipients.
export const posUpdatesAnnouncementDraft = {
  id: "pos-updates-2026-10", revision: 1, category: "improvement", severity: "info",
  title: "Actualizaciones del terminal Volta POS",
  message: "El POS avisa cuando hay una actualización y permite leer sus novedades. Puedes actualizar ahora, elegir fecha y hora o dejarla pendiente. Tu elección se conserva; si no se cumplen las condiciones en el plazo elegido, la actualización queda pendiente sin interrumpir el servicio.",
  translations: {
    en: { title: "Volta POS terminal updates", message: "The POS notifies you when an update is available and lets you read its release notes. You can update now, choose a date and time or leave it pending. Your choice is saved; if conditions are not met within the selected window, the update remains pending without interrupting service." },
    it: { title: "Aggiornamenti del terminale Volta POS", message: "Il POS segnala gli aggiornamenti disponibili e consente di leggerne le novità. Puoi aggiornare subito, scegliere data e ora o lasciare l’aggiornamento in sospeso. La scelta viene salvata; se le condizioni non sono soddisfatte nel periodo scelto, l’aggiornamento resta in sospeso senza interrompere il servizio." },
    fr: { title: "Mises à jour du terminal Volta POS", message: "Le POS signale les mises à jour disponibles et permet de lire leurs nouveautés. Vous pouvez mettre à jour maintenant, choisir une date et une heure ou laisser la mise à jour en attente. Votre choix est conservé ; si les conditions ne sont pas réunies dans le délai choisi, elle reste en attente sans interrompre le service." },
    pt: { title: "Atualizações do terminal Volta POS", message: "O POS avisa quando existe uma atualização e permite ler as novidades. Pode atualizar agora, escolher uma data e hora ou deixar pendente. A escolha fica guardada; se as condições não forem cumpridas no prazo escolhido, a atualização fica pendente sem interromper o serviço." },
  },
};
// Draft: publish only when APK 0.3.12 or later is distributed to the recipients.
export const posInitialEnrollmentAnnouncementDraft = {
  id: "pos-initial-enrollment-2026-10", revision: 1,
  category: "improvement", severity: "info",
  title: "Registro inicial de nuevos terminales POS",
  message: "Al abrir Volta en un terminal nuevo, introduce el código de alta proporcionado por Volta. Una vez autorizado el equipo, accede a tu tienda con su usuario y PIN POS.",
  translations: {
    en: { title: "Initial registration of new POS terminals", message: "When opening Volta on a new terminal, enter the enrollment code provided by Volta. Once the device is authorized, sign in to your store using its username and POS PIN." },
    it: { title: "Registrazione iniziale dei nuovi terminali POS", message: "Quando apri Volta su un nuovo terminale, inserisci il codice di registrazione fornito da Volta. Dopo l’autorizzazione del dispositivo, accedi al tuo negozio con il suo nome utente e PIN POS." },
    fr: { title: "Enregistrement initial des nouveaux terminaux POS", message: "À l’ouverture de Volta sur un nouveau terminal, saisissez le code d’enregistrement fourni par Volta. Une fois l’appareil autorisé, connectez-vous à votre boutique avec son identifiant et son code PIN POS." },
    pt: { title: "Registo inicial de novos terminais POS", message: "Ao abrir a Volta num novo terminal, introduza o código de registo fornecido pela Volta. Após a autorização do equipamento, aceda à sua loja com o respetivo utilizador e PIN POS." },
  },
};
// Keep IDs stable; increase revision only when users need to read the note again.
// Draft: add to backofficeAnnouncements and set publication dates only after the
// matching storefront is available. This export alone does not enter the feed.
export const conciseClearanceBannerAnnouncementDraft = {
  id: "concise-clearance-banner-2026-10", revision: 1,
  category: "improvement", severity: "info",
  title: "Liquidación más clara en la ficha",
  message: "El aviso de liquidación se resume en recogida sin pedido mínimo, tiempo restante y unidades disponibles para añadir. Tus clientes pueden consultar lo esencial de un vistazo; las condiciones de compra se mantienen.",
  translations: {
    en: { title: "Clearer clearance product details", message: "The clearance notice now summarises pickup with no minimum order, time remaining and units available to add. Customers can see the essentials at a glance; purchase conditions remain unchanged." },
    it: { title: "Liquidazione più chiara nella scheda", message: "L’avviso di liquidazione riassume ritiro senza ordine minimo, tempo rimanente e unità disponibili da aggiungere. I clienti possono vedere subito le informazioni essenziali; le condizioni di acquisto restano invariate." },
    fr: { title: "Une fiche de déstockage plus claire", message: "L’avis de déstockage résume le retrait sans minimum de commande, le temps restant et les unités disponibles à ajouter. Les clients voient l’essentiel en un coup d’œil ; les conditions d’achat restent inchangées." },
    pt: { title: "Liquidação mais clara na ficha", message: "O aviso de liquidação resume a recolha sem pedido mínimo, o tempo restante e as unidades disponíveis para adicionar. Os clientes consultam o essencial num instante; as condições de compra mantêm-se." },
  },
};

export const logoPreparationAnnouncementDraft = {
  "id": "logo-preparation-2026-10",
  "revision": 1,
  "category": "improvement",
  "severity": "info",
  "title": "Sube tu logo y listo",
  "message": "Selecciona tu logo en los ajustes del backoffice: se prepara y guarda automáticamente, sin pasos de confirmación. Quitamos el fondo exterior cuando se puede separar y ajustamos los márgenes.",
  "detail": "El original se conserva internamente. Si no podemos separar el fondo con seguridad, guardamos la imagen con su fondo y mostramos un aviso breve. Para actualizar un logo anterior, vuelve a subir su archivo.",
  "translations": {
    "en": {
      "title": "Upload your logo and you’re done",
      "message": "Select your logo in backoffice settings: it is prepared and saved automatically, with no confirmation steps. We remove the outer background when it can be separated and adjust the margins.",
      "detail": "The original is retained internally. If the background cannot be safely separated, we save the image with its background and show a short notice. To update an older logo, upload its file again."
    },
    "it": {
      "title": "Carica il tuo logo e basta",
      "message": "Seleziona il logo nelle impostazioni del backoffice: viene preparato e salvato automaticamente, senza conferme. Rimuoviamo lo sfondo esterno quando è separabile e adattiamo i margini.",
      "detail": "L’originale viene conservato internamente. Se lo sfondo non può essere separato con sicurezza, salviamo l’immagine con lo sfondo e mostriamo un breve avviso. Per aggiornare un logo precedente, carica nuovamente il file."
    },
    "fr": {
      "title": "Chargez votre logo, et c’est tout",
      "message": "Sélectionnez votre logo dans les paramètres du backoffice : il est préparé et enregistré automatiquement, sans confirmation. Nous supprimons le fond extérieur lorsqu’il peut être séparé et ajustons les marges.",
      "detail": "L’original est conservé en interne. Si le fond ne peut pas être séparé avec certitude, nous enregistrons l’image avec son fond et affichons un bref message. Pour actualiser un ancien logo, chargez à nouveau son fichier."
    },
    "pt": {
      "title": "Carregue o seu logótipo e pronto",
      "message": "Selecione o logótipo nas definições do backoffice: é preparado e guardado automaticamente, sem confirmações. Removemos o fundo exterior quando é possível separá-lo e ajustamos as margens.",
      "detail": "O original fica guardado internamente. Se não conseguirmos separar o fundo com segurança, guardamos a imagem com o fundo e mostramos um aviso breve. Para atualizar um logótipo anterior, carregue novamente o ficheiro."
    }
  }
};

export const unifiedStoreGateAnnouncementDraft = {
  id: "unified-store-gate-2026-10", revision: 1,
  category: "improvement", severity: "info",
  title: "Una entrada común para todas las pizzerías",
  message: "La entrada muestra el logo de tu negocio sobre el mismo fondo animado y el botón Pedir en línea. Espera los datos del negocio antes de mostrar el logo definitivo, sin cambiar de imagen al terminar la carga. Si no tienes logo, aparece el nombre de tu pizzería.",
  translations: {
    en: { title: "A shared entrance for every pizzeria", message: "The entrance displays your business logo on the same animated background with the Pedir en línea button. It waits for business data before showing the final logo, without switching images when loading finishes. If you have no logo, your pizzeria name appears." },
    it: { title: "Un ingresso comune per tutte le pizzerie", message: "L’ingresso mostra il logo della tua attività sullo stesso sfondo animato con il pulsante Pedir en línea. Attende i dati dell’attività prima di mostrare il logo definitivo, senza cambiare immagine al termine del caricamento. Se non hai un logo, appare il nome della pizzeria." },
    fr: { title: "Une entrée commune à toutes les pizzerias", message: "L’entrée affiche le logo de votre établissement sur le même fond animé avec le bouton Pedir en línea. Elle attend les données de l’établissement avant d’afficher le logo définitif, sans changer d’image à la fin du chargement. Sans logo, le nom de votre pizzeria apparaît." },
    pt: { title: "Uma entrada comum para todas as pizzarias", message: "A entrada apresenta o logótipo do seu negócio sobre o mesmo fundo animado e o botão Pedir en línea. Aguarda os dados do negócio antes de mostrar o logótipo definitivo, sem trocar a imagem quando termina o carregamento. Se não tiver logótipo, aparece o nome da pizzaria." },
  },
};

export const partnerLogoAnnouncementDraft = {
  id: "partner-logo-2026-10", revision: 1,
  category: "improvement", severity: "info",
  title: "Tu logo en la entrada y en cupones",
  message: "El logo que subes en los ajustes del backoffice identifica tu negocio en la entrada, al iniciar el pedido y en la galería de cupones. Si falta o no carga, el nombre sigue visible. La carta ya no utiliza el logo como fondo gris.",
  detail: "El logo se comparte entre las sucursales del negocio. Al reemplazarlo, el anterior se conserva hasta guardar correctamente el nuevo. Para mostrarlo sin recuadro, utiliza un PNG con fondo transparente y sin márgenes grandes.",
  translations: {
    en: { title: "Your logo at the entrance and in coupons", message: "The logo uploaded in backoffice settings identifies your business at the entrance, when starting an order and in the coupon gallery. If it is missing or fails to load, the name remains visible. The menu no longer uses the logo as a grey background.", detail: "The logo is shared across your business locations. When replacing it, the previous logo is kept until the new one is saved successfully. To display it without a rectangle, use a PNG with a transparent background and no large margins." },
    it: { title: "Il tuo logo all’ingresso e nei coupon", message: "Il logo caricato nelle impostazioni del backoffice identifica la tua attività all’ingresso, all’inizio dell’ordine e nella galleria dei coupon. Se manca o non si carica, il nome resta visibile. Il menu non usa più il logo come sfondo grigio.", detail: "Il logo è condiviso tra le sedi dell’attività. Quando lo sostituisci, il precedente viene conservato finché il nuovo non è salvato correttamente. Per mostrarlo senza riquadro, usa un PNG con sfondo trasparente e senza margini ampi." },
    fr: { title: "Votre logo à l’entrée et dans les coupons", message: "Le logo chargé dans les paramètres du backoffice identifie votre établissement à l’entrée, au début de la commande et dans la galerie de coupons. S’il manque ou ne se charge pas, le nom reste visible. La carte n’utilise plus le logo comme fond gris.", detail: "Le logo est partagé entre les points de vente de votre établissement. Lors de son remplacement, le précédent est conservé jusqu’à l’enregistrement réussi du nouveau. Pour l’afficher sans rectangle, utilisez un PNG à fond transparent et sans grandes marges." },
    pt: { title: "O seu logótipo na entrada e nos cupões", message: "O logótipo carregado nas definições do backoffice identifica o seu negócio na entrada, ao iniciar o pedido e na galeria de cupões. Se faltar ou não carregar, o nome continua visível. A ementa já não utiliza o logótipo como fundo cinzento.", detail: "O logótipo é partilhado entre as lojas do negócio. Ao substituí-lo, o anterior é mantido até o novo ser guardado com sucesso. Para o mostrar sem retângulo, utilize um PNG com fundo transparente e sem margens grandes." },
  },
};

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

// Published after verifying the matching storefront release.
export const singleLineCardPricesAnnouncement = {
  id: 'single-line-card-prices-2026-10', revision: 1, category: 'improvement', severity: 'info',
  publishedAt: '2026-10-01T11:31:42.000Z', expiresAt: '2027-01-01T11:31:42.000Z',
  title: 'Precios más claros en el móvil',
  message: 'La moneda y el importe permanecen juntos en una línea en las tarjetas de la carta. Si falta espacio en un Top Deal, la disponibilidad pasa debajo. Revisa tu carta desde el móvil; no necesitas cambiar los precios.',
  translations: {
    en: { title: 'Clearer prices on mobile', message: 'The currency and amount stay together on one line in menu cards. If a Top Deal runs out of space, availability moves below. Check your menu on mobile; no price changes are needed.' },
    it: { title: 'Prezzi più chiari sul cellulare', message: 'Valuta e importo restano insieme su una riga nelle schede del menu. Se manca spazio in un Top Deal, la disponibilità passa sotto. Controlla il menu dal cellulare; non occorre modificare i prezzi.' },
    fr: { title: 'Des prix plus lisibles sur mobile', message: 'La devise et le montant restent ensemble sur une ligne dans les fiches de la carte. Si un Top Deal manque de place, la disponibilité passe en dessous. Consultez votre carte sur mobile ; aucun changement de prix n’est nécessaire.' },
    pt: { title: 'Preços mais claros no telemóvel', message: 'A moeda e o valor ficam juntos numa linha nos cartões da ementa. Se faltar espaço num Top Deal, a disponibilidade passa para baixo. Consulte a ementa no telemóvel; não precisa de alterar os preços.' },
  },
};

export const backofficeAnnouncements = [
  singleLineCardPricesAnnouncement,
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

// Draft: add release dates and include in the feed only once the storefront is deployed.
export const deliveryMethodSelectorAnnouncementDraft = {
  id: 'storefront-delivery-method-selector-2026-09', revision: 1,
  category: 'improvement', severity: 'info',
  title: 'Método de entrega más visible en la tienda online',
  message: 'La cabecera destaca en naranja si el pedido es para recoger o enviar a domicilio y alterna ese mensaje con el destino. Toca el destino o el pequeño lápiz para revisar el método de entrega desde el móvil o el ordenador.',
  translations: {
    en: { title: 'A clearer delivery method in your online store', message: 'The header highlights collection or home delivery in orange, alternating that message with the destination. Customers can tap the destination or small pencil to review their delivery method on mobile or desktop.' },
    it: { title: 'Modalità di consegna più visibile nel negozio online', message: 'L’intestazione evidenzia in arancione il ritiro o la consegna a domicilio, alternando il messaggio con la destinazione. Tocca la destinazione o la piccola matita per rivedere la modalità di consegna da telefono o computer.' },
    fr: { title: 'Un mode de livraison plus visible dans la boutique en ligne', message: 'L’en-tête met en évidence en orange le retrait ou la livraison à domicile, en alternant ce message avec la destination. Touchez la destination ou le petit crayon pour revoir le mode de livraison sur mobile ou ordinateur.' },
    pt: { title: 'Método de entrega mais visível na loja online', message: 'O cabeçalho destaca a laranja se o pedido é para recolha ou entrega ao domicílio, alternando a mensagem com o destino. Toque no destino ou no pequeno lápis para rever o método de entrega no telemóvel ou computador.' },
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
// Publish only with the coordinated storefront/backend rollout.
export const topDealDeletedProductRecoveryDraft = {
  id: "top-deal-deleted-product-recovery-2026-09", revision: 1,
  category: "improvement", severity: "info",
  title: "Editar Top Deals con productos eliminados",
  message: "Al guardar un Top Deal antiguo, se retiran las referencias a productos eliminados y se conservan los productos válidos. Si ya no queda ninguno, el backoffice te pide elegir otro antes de guardar.",
  translations: {
    en: { title: "Edit Top Deals with deleted products", message: "Saving an older Top Deal removes references to deleted products and keeps valid products. If none remain, the backoffice asks you to select another product before saving." },
    it: { title: "Modificare Top Deal con prodotti eliminati", message: "Salvando un vecchio Top Deal vengono rimossi i riferimenti ai prodotti eliminati e mantenuti quelli validi. Se non ne rimane nessuno, il backoffice chiede di selezionare un altro prodotto prima di salvare." },
    fr: { title: "Modifier les Top Deals avec des produits supprimés", message: "Enregistrer un ancien Top Deal retire les références aux produits supprimés et conserve les produits valides. S’il n’en reste aucun, le backoffice demande de choisir un autre produit avant d’enregistrer." },
    pt: { title: "Editar Top Deals com produtos eliminados", message: "Ao guardar um Top Deal antigo, são retiradas as referências a produtos eliminados e mantidos os produtos válidos. Se não restar nenhum, o backoffice pede para selecionar outro produto antes de guardar." },
  },
};

// Activate together with the updated backoffice after deployment.
export const linkedProductDeletionGuardDraft = {
  id: "linked-product-deletion-guard-2026-09", revision:1,category:"improvement",severity:"info",
  title:"Productos vinculados protegidos",
  message:"Al intentar eliminar un producto, un cartel amarillo de Volta con letras púrpuras muestra sus Top Deals, promos, incentivos y reglas de precio vinculados, con cantidades y nombres. Retira esas vinculaciones antes de eliminarlo; desactivar una oferta no elimina su vínculo.",
  translations:{
    en:{title:"Linked products protected",message:"When you try to delete a product, a yellow Volta notice with purple text lists its linked Top Deals, promos, incentives and price rules, with counts and names. Remove these links before deleting it; deactivating an offer does not remove its link."},
    it:{title:"Prodotti collegati protetti",message:"Quando provi a eliminare un prodotto, un avviso giallo Volta con testo viola elenca Top Deal, promo, incentivi e regole di prezzo collegati, con quantità e nomi. Rimuovi questi collegamenti prima di eliminarlo; disattivare un’offerta non elimina il collegamento."},
    fr:{title:"Protection des produits liés",message:"Lorsque vous essayez de supprimer un produit, un avis Volta jaune au texte violet affiche ses Top Deals, promos, récompenses et règles de prix liés, avec leurs nombres et noms. Retirez ces liens avant de le supprimer ; désactiver une offre ne retire pas son lien."},
    pt:{title:"Produtos associados protegidos",message:"Ao tentar eliminar um produto, um aviso amarelo da Volta com texto roxo apresenta os Top Deals, promos, incentivos e regras de preço associados, com quantidades e nomes. Remova essas associações antes de o eliminar; desativar uma oferta não elimina a associação."},
  },
};

// Activate with the matching storefront release.
export const catalogSurfaceAnnouncementDraft = {
  id:'catalog-continuous-surface-2026-09', revision:1, category:'improvement', severity:'info',
  title:'Más espacio al final de la carta',
  message:'El fondo de la carta se extiende hasta la zona de pago aunque una categoría tenga pocos productos. Las tarjetas dejan margen a ambos lados dentro del panel blanco. La última tarjeta conserva espacio para leerse completa al terminar de desplazarte, también en la vitrina ampliada.',
  translations:{
    en:{title:'More room at the end of the menu',message:'The menu background extends to the payment area even when a category has few products. Cards leave room on both sides inside the white panel. The last card has room to remain fully readable at the end of scrolling, including in the expanded catalog.'},
    it:{title:'Più spazio alla fine del menu',message:'Lo sfondo del menu si estende fino all’area di pagamento anche nelle categorie con pochi prodotti. Le schede lasciano spazio su entrambi i lati del pannello bianco. L’ultima scheda resta interamente leggibile alla fine dello scorrimento, anche nella vetrina ampliata.'},
    fr:{title:'Plus d’espace en bas de la carte',message:'Le fond de la carte s’étend jusqu’à la zone de paiement, même dans les catégories avec peu de produits. Les fiches gardent une marge de chaque côté dans le panneau blanc. La dernière fiche reste entièrement lisible en fin de défilement, y compris dans la vitrine agrandie.'},
    pt:{title:'Mais espaço no fim da ementa',message:'O fundo da ementa estende-se até à zona de pagamento mesmo nas categorias com poucos produtos. Os cartões deixam espaço dos dois lados dentro do painel branco. O último cartão mantém espaço para ser lido por completo no fim da deslocação, incluindo na montra ampliada.'},
  },
};

export const multiSizePricesAnnouncementDraft = {
  id:'multi-size-card-prices-2026-09', revision:1, category:'improvement', severity:'info',
  title:'Cada tamaño con su precio',
  message:'Los productos con varios tamaños alternan su precio y tamaño entre paréntesis cada dos segundos, con el ritmo de Trending. Los productos de un solo tamaño mantienen su presentación habitual.',
  translations:{
    en:{title:'A price for every size',message:'Products with multiple sizes rotate their price and size in parentheses every two seconds, matching the Trending cadence. Single-size products keep their usual presentation.'},
    it:{title:'Un prezzo per ogni formato',message:'I prodotti con più formati alternano prezzo e formato tra parentesi ogni due secondi, con il ritmo di Trending. I prodotti con un solo formato mantengono la presentazione abituale.'},
    fr:{title:'Un prix pour chaque taille',message:'Les produits proposés en plusieurs tailles alternent leur prix et leur taille entre parenthèses toutes les deux secondes, au rythme de Trending. Ceux à taille unique conservent leur présentation habituelle.'},
    pt:{title:'Um preço para cada tamanho',message:'Os produtos com vários tamanhos alternam o preço e o tamanho entre parênteses a cada dois segundos, ao ritmo de Trending. Os produtos de tamanho único mantêm a apresentação habitual.'},
  },
};

// Activate with the updated backoffice release.
export const compactTopDealsTableAnnouncementDraft = {
  id: 'compact-top-deals-table-2026-09', revision: 1, category: 'improvement', severity: 'info',
  title: 'Top Deals publicados más fáciles de leer',
  message: 'La tabla del backoffice muestra cantidad disponible y unidades usadas como 5 / 0, y solo el número de productos y tiendas seleccionados. Configurar hoy ocupa una sola línea. El símbolo ∞ indica cantidad ilimitada.',
  translations: {
    en: { title: 'Published Top Deals are easier to read', message: 'The backoffice table shows available quantity and used units as 5 / 0, and only the count of selected products and stores. Configure today stays on one line. The ∞ symbol means unlimited quantity.' },
    it: { title: 'Top Deal pubblicati più facili da leggere', message: 'La tabella del backoffice mostra quantità disponibile e unità utilizzate come 5 / 0, e solo il numero di prodotti e negozi selezionati. Configura oggi resta su una sola riga. Il simbolo ∞ indica quantità illimitata.' },
    fr: { title: 'Des Top Deals publiés plus lisibles', message: 'Le tableau du backoffice affiche la quantité disponible et les unités utilisées sous la forme 5 / 0, avec uniquement le nombre de produits et de boutiques sélectionnés. Configurer aujourd’hui tient sur une ligne. Le symbole ∞ indique une quantité illimitée.' },
    pt: { title: 'Top Deals publicados mais fáceis de ler', message: 'A tabela do backoffice mostra a quantidade disponível e as unidades utilizadas como 5 / 0, e apenas o número de produtos e lojas selecionados. Configurar hoje fica numa só linha. O símbolo ∞ indica quantidade ilimitada.' },
  },
};

export const clearanceTopDealAnnouncementDraft = {
  id: "clearance-top-deal-2026-09", revision: 1,
  category: "improvement", severity: "info",
  title: "Liquidación dentro de Top Deal",
  message: "Marca Producto en liquidación al crear o editar un Top Deal. Se identifica con una banda roja horizontal con el texto centrado que se desvanece y reaparece suavemente en la carta y permite recoger sin pedido mínimo, también en carritos mixtos. Conserva las cantidades y la duración del Top Deal.",
  detail: "El delivery exige el mínimo de productos después de descuentos, sin contar portes. La liquidación no recibe descuentos adicionales ni desbloquea regalos o envío gratis. Las promos conservan su precio global, aunque incluyan productos vendidos también en liquidación; los descuentos individuales no se acumulan. Conserva los beneficios de los demás productos y cobra los bloques adicionales de reparto que genere.",
  translations: {
    en: { title: "Clearance within Top Deal", message: "Select Clearance product when creating or editing a Top Deal. A horizontal red ribbon with centered text that gently fades out and back in identifies it on the menu and allows pickup without a minimum order, including mixed carts. Top Deal quantities and duration still apply.", detail: "Delivery requires the minimum product spend after discounts, excluding shipping. Clearance gets no extra discounts and does not unlock gifts or free shipping. Packs keep their configured total price even when a component is also sold on clearance; individual discounts do not stack. Other products keep their benefits; any additional delivery blocks caused by clearance are charged." },
    it: { title: "Liquidazione all’interno di Top Deal", message: "Seleziona Prodotto in liquidazione quando crei o modifichi un Top Deal. Una fascia rossa orizzontale con testo centrato che sfuma e riappare dolcemente identifica il prodotto nel menu e consente il ritiro senza ordine minimo, anche nei carrelli misti. Restano valide quantità e durata del Top Deal.", detail: "La consegna richiede l’importo minimo dei prodotti dopo gli sconti, escluse le spese di consegna. La liquidazione non riceve altri sconti né sblocca omaggi o consegna gratuita. Le promo mantengono il prezzo globale anche se includono prodotti venduti anche in liquidazione; gli sconti individuali non si sommano. Gli altri prodotti mantengono i benefici; i blocchi di consegna aggiuntivi generati dalla liquidazione sono a pagamento." },
    fr: { title: "Liquidation dans Top Deal", message: "Sélectionnez Produit en liquidation lors de la création ou de la modification d’un Top Deal. Un bandeau rouge horizontal au texte centré qui disparaît et réapparaît en douceur le signale sur la carte et permet le retrait sans minimum de commande, même avec d’autres produits. Les quantités et la durée du Top Deal restent applicables.", detail: "La livraison exige le minimum de produits après réductions, hors frais de livraison. La liquidation ne reçoit aucune réduction supplémentaire et ne débloque ni cadeaux ni livraison gratuite. Les packs conservent leur prix global même si un produit est aussi vendu en liquidation ; les réductions individuelles ne se cumulent pas. Les autres produits conservent leurs avantages ; les blocs de livraison supplémentaires dus à la liquidation sont facturés." },
    pt: { title: "Liquidação dentro do Top Deal", message: "Selecione Produto em liquidação ao criar ou editar um Top Deal. Uma faixa vermelha horizontal com texto centrado que desaparece e reaparece suavemente identifica o produto na ementa e permite recolha sem pedido mínimo, incluindo carrinhos mistos. Mantêm-se as quantidades e a duração do Top Deal.", detail: "A entrega exige o mínimo em produtos após descontos, sem contar portes. A liquidação não recebe descontos adicionais nem desbloqueia ofertas ou portes grátis. Os packs mantêm o preço global mesmo quando incluem produtos também vendidos em liquidação; os descontos individuais não se acumulam. Os restantes produtos mantêm os benefícios; os blocos de entrega adicionais gerados pela liquidação são cobrados." },
  },
};
// Draft: publish only after the coordinated web-auth migration and recovery checks.
export const simpleBackofficeAccessAnnouncementDraft = {
  id: 'business-access-2026-10', revision: 2, category: 'improvement', severity: 'info',
  title: 'Acceso sencillo y contraseña opcional',
  message: 'El usuario y la contraseña inicial son el identificador del partner. Puedes recordar este dispositivo durante 90 días y cambiar tu contraseña cuando quieras desde Ajustes → Cuenta y contraseña, sin longitud mínima ni caracteres especiales obligatorios. Si ya elegiste una contraseña, sigue vigente.',
  translations: {
    en: { title: 'Simple access and optional password changes', message: 'The initial username and password are your partner identifier. Remember this device for 90 days and change your password whenever you choose in Settings → Account and password, without a minimum length or required special characters. Any password you already chose remains valid.' },
    it: { title: 'Accesso semplice e cambio password facoltativo', message: 'Il nome utente e la password iniziali sono l’identificativo del partner. Puoi ricordare questo dispositivo per 90 giorni e cambiare la password in Impostazioni → Account e password, senza lunghezza minima o caratteri speciali obbligatori. La password già scelta resta valida.' },
    fr: { title: 'Accès simple et changement de mot de passe facultatif', message: 'L’identifiant et le mot de passe initiaux sont l’identifiant du partner. Vous pouvez mémoriser cet appareil pendant 90 jours et modifier le mot de passe dans Paramètres → Compte et mot de passe, sans longueur minimale ni caractères spéciaux obligatoires. Le mot de passe déjà choisi reste valide.' },
    pt: { title: 'Acesso simples e alteração opcional da palavra-passe', message: 'O utilizador e a palavra-passe iniciais são o identificador do partner. Pode lembrar este dispositivo durante 90 dias e alterar a palavra-passe em Definições → Conta e palavra-passe, sem comprimento mínimo nem caracteres especiais obrigatórios. A palavra-passe já escolhida mantém-se válida.' },
  },
};

export const businessAccessAnnouncementDraft = {
  id: "business-access-2026-10", revision: 1, category: "improvement", severity: "info",
  title: "El acceso de tu negocio",
  message: "Los enlaces del backoffice y del POS web identifican tu negocio. En la bienvenida recibirás un enlace temporal para crear tu contraseña. El acceso comprueba tu cuenta antes de mostrar datos.",
  translations: {
    en: { title: "Your business access", message: "The backoffice and web POS links identify your business. Your welcome email includes a temporary link to create your password. Access verifies your account before displaying data." },
    it: { title: "L’accesso della tua attività", message: "I link del backoffice e del POS web identificano la tua attività. L’email di benvenuto include un link temporaneo per creare la password. L’accesso verifica l’account prima di mostrare i dati." },
    fr: { title: "L’accès à votre établissement", message: "Les liens du backoffice et du POS web identifient votre établissement. L’email de bienvenue contient un lien temporaire pour créer votre mot de passe. L’accès vérifie votre compte avant d’afficher les données." },
    pt: { title: "O acesso ao seu negócio", message: "Os links do backoffice e do POS web identificam o seu negócio. O email de boas-vindas inclui um link temporário para criar a sua palavra-passe. O acesso verifica a conta antes de mostrar os dados." },
  },
};

// Publish only with the coordinated backend, backoffice and POS release.
export const storeReceptionAnnouncementDraft = {
  id: 'store-reception-2026-10', revision: 1, category: 'improvement', severity: 'info',
  title: 'Abrir pedidos con un estado claro',
  message: 'En Tiendas verás si la tienda está habilitada y si recibe pedidos online. Abrir pedidos comprueba la preparación y explica qué falta. El POS usa el mismo control; las pausas y los horarios conservan los pedidos programados.',
  translations: {
    en: { title: 'Open orders with a clear status', message: 'Stores now shows whether a store is enabled and receiving online orders. Open orders checks readiness and explains what is missing. The POS uses the same control; pauses and opening hours preserve scheduled orders.' },
    it: { title: 'Apri gli ordini con uno stato chiaro', message: 'In Negozi puoi vedere se il negozio è abilitato e riceve ordini online. Apri ordini verifica la preparazione e spiega cosa manca. Il POS usa lo stesso controllo; pause e orari conservano gli ordini programmati.' },
    fr: { title: 'Ouvrir les commandes avec un état clair', message: 'Boutiques indique si la boutique est activée et reçoit des commandes en ligne. Ouvrir les commandes vérifie la préparation et explique ce qui manque. Le POS utilise le même contrôle ; les pauses et horaires préservent les commandes programmées.' },
    pt: { title: 'Abrir pedidos com um estado claro', message: 'Em Lojas podes ver se a loja está habilitada e recebe pedidos online. Abrir pedidos verifica a preparação e explica o que falta. O POS usa o mesmo controlo; as pausas e os horários mantêm os pedidos agendados.' },
  },
};

// Publish only when the full offer/payment/signature flow is available.
export const onboardingCommercialAnnouncementDraft = {
  id: 'onboarding-commercial-2026-10', revision: 1, category: 'improvement', severity: 'info',
  title: 'Elige tu POS durante la incorporación',
  message: 'La fase 2 permite elegir compra al contado o cuotas y solicitar una oferta de alquiler. Puedes guardar el avance y revisar el resumen antes de enviarlo. El equipo y los SMS se pagan aparte de las ventas; enviar el formulario no realiza ningún cobro.',
  translations: {
    en: { title: 'Choose your POS during onboarding', message: 'Phase 2 lets you choose an upfront purchase or installments, or request a rental quote. Save your progress and review the summary before submitting. Equipment and SMS are paid separately from sales; submitting the form does not charge you.' },
    it: { title: 'Scegli il POS durante l’attivazione', message: 'La fase 2 permette di scegliere acquisto immediato o rate e richiedere un preventivo di noleggio. Puoi salvare i progressi e controllare il riepilogo prima dell’invio. Attrezzatura e SMS si pagano separatamente dalle vendite; l’invio non comporta addebiti.' },
    fr: { title: 'Choisissez votre POS pendant l’inscription', message: 'La phase 2 permet de choisir un achat comptant ou échelonné et de demander un devis de location. Enregistrez votre progression et vérifiez le récapitulatif avant l’envoi. Le matériel et les SMS sont payés séparément des ventes ; l’envoi du formulaire ne déclenche aucun paiement.' },
    pt: { title: 'Escolhe o POS durante a adesão', message: 'A fase 2 permite escolher compra a pronto ou em prestações e pedir uma proposta de aluguer. Podes guardar o progresso e rever o resumo antes de enviar. O equipamento e os SMS são pagos separadamente das vendas; enviar o formulário não gera cobranças.' },
  },
};
// Draft: activate only after the coordinated onboarding closure release.
export const onboardingEmailsAnnouncementDraft = {
  id: 'onboarding-three-emails-2026-10', revision: 2, category: 'improvement', severity: 'info',
  title: 'La incorporación en tres correos',
  message: 'Recibirás la solicitud, el contrato para firmar y pagar, y la bienvenida con el acceso de tu negocio. Si falla la bienvenida, Volta puede reenviarla sin repetir el alta ni el pago. La recepción de pedidos se abre después de preparar la tienda.',
  translations: {
    en: { title: 'Onboarding in three emails', message: 'You receive the application, the contract to sign and pay, and a welcome email with access to your business. If the welcome email fails, Volta can resend it without repeating activation or payment. Order reception opens after the store is ready.' },
    it: { title: 'L’adesione in tre email', message: 'Riceverai la richiesta, il contratto da firmare e pagare e il benvenuto con l’accesso alla tua attività. Se l’email di benvenuto non viene inviata, Volta può reinviarla senza ripetere l’attivazione o il pagamento. La ricezione degli ordini si apre dopo aver preparato il negozio.' },
    fr: { title: 'L’inscription en trois emails', message: 'Vous recevez la demande, le contrat à signer avant de payer, puis un email de bienvenue avec l’accès à votre établissement. En cas d’échec de l’envoi, Volta peut renvoyer le message de bienvenue sans répéter l’activation ni le paiement. La réception des commandes s’ouvre après la préparation de la boutique.' },
    pt: { title: 'A adesão em três emails', message: 'Receberá a candidatura, o contrato para assinar e pagar e as boas-vindas com o acesso ao seu negócio. Se o envio das boas-vindas falhar, a Volta pode reenviá-las sem repetir a ativação nem o pagamento. A receção de pedidos abre depois de preparar a loja.' },
  },
};

export const onboardingClosureAnnouncementDraft = {
  id: 'onboarding-payment-signature-2026-10', revision: 1, category: 'improvement', severity: 'info',
  title: 'Precio del POS y cierre de incorporación',
  message: 'En Global Manager, abre Onboarding para definir la tarifa de nuevas altas y preparar la oferta de cada comercio. Revisa precio, disponibilidad y entrega; el cliente acepta las condiciones, paga y después firma.',
  detail: 'El renting admite 36 mensualidades con transmisión final del POS. Cada oferta conserva sus importes. El pago debe confirmarse antes de la firma; las cancelaciones y devoluciones se consultan en el expediente.',
  translations: {
    en: { title: 'POS pricing and onboarding completion', message: 'In Global Manager, open Onboarding to set the price for new applications and prepare each merchant’s offer. Check pricing, availability and delivery; the merchant accepts the terms, pays, then signs.', detail: 'Rental plans support 36 monthly payments with final ownership transfer. Each offer keeps its agreed amounts. Payment must be confirmed before signing; cancellations and refunds are tracked in the application.' },
    it: { title: 'Prezzo del POS e completamento dell’adesione', message: 'In Global Manager, apri Onboarding per impostare il prezzo delle nuove richieste e preparare l’offerta di ogni commerciante. Verifica prezzo, disponibilità e consegna; il cliente accetta le condizioni, paga e poi firma.', detail: 'Il noleggio prevede 36 rate mensili con trasferimento finale della proprietà del POS. Ogni offerta conserva i propri importi. Il pagamento deve essere confermato prima della firma; annullamenti e rimborsi sono visibili nella pratica.' },
    fr: { title: 'Prix du POS et finalisation de l’inscription', message: 'Dans Global Manager, ouvrez Onboarding pour définir le prix des nouvelles demandes et préparer l’offre de chaque commerçant. Vérifiez le prix, la disponibilité et la livraison ; le client accepte les conditions, paie puis signe.', detail: 'La location prévoit 36 mensualités avec transfert final de propriété du POS. Chaque offre conserve ses montants. Le paiement doit être confirmé avant la signature ; annulations et remboursements sont suivis dans le dossier.' },
    pt: { title: 'Preço do POS e conclusão da adesão', message: 'No Global Manager, abra Onboarding para definir o preço das novas candidaturas e preparar a oferta de cada comerciante. Verifique preço, disponibilidade e entrega; o cliente aceita as condições, paga e depois assina.', detail: 'O renting prevê 36 mensalidades com transferência final da propriedade do POS. Cada oferta conserva os seus valores. O pagamento deve ser confirmado antes da assinatura; cancelamentos e reembolsos são acompanhados no processo.' },
  },
};

// Published after verifying the coordinated backend/storefront release on 5 October 2026.
export const onboardingDefaultsAnnouncementDraft = {
  id: 'onboarding-shared-defaults-2026-10', revision: 1, category: 'improvement', severity: 'info',
  title: 'Tarifas y ofertas de incorporación más claras',
  message: 'Configura las tarifas vigentes del POS y SMS desde Onboarding. El contrato se genera con los datos y la elección del comercio. El primer correo presenta las tres modalidades del POS. Los SMS son una herramienta disponible de uso opcional, con recargas por separado: el proceso explica la tarifa vigente y los paquetes, sin casilla de contratación ni recarga obligatoria. El contrato describe el servicio sin fijar un precio permanente.',
  translations: {
    en: { title: 'Clearer onboarding prices and offers', message: 'Set current POS and SMS prices in Onboarding. The contract is generated from the merchant’s details and selection. The first email presents the three POS options. SMS is an available tool with optional usage and separate top-ups: onboarding explains current prices and packages, without an activation checkbox or mandatory top-up. The contract describes the service without fixing a permanent price.' },
    it: { title: 'Tariffe e offerte di adesione più chiare', message: 'Configura tariffe vigenti di POS e SMS in Onboarding. Il contratto viene generato dai dati e dalla scelta del commerciante. La prima email presenta le tre opzioni del POS. Gli SMS sono uno strumento disponibile di uso facoltativo, con ricariche separate: il processo spiega tariffe e pacchetti vigenti, senza casella di attivazione né ricarica obbligatoria. Il contratto descrive il servizio senza fissare un prezzo permanente.' },
    fr: { title: 'Des tarifs et offres d’inscription plus clairs', message: 'Configurez les tarifs actuels du POS et des SMS dans Onboarding. Le contrat est généré à partir des données et du choix du commerçant. Le premier email présente les trois options du POS. Les SMS sont un outil disponible à usage facultatif, avec des recharges séparées : le parcours explique les tarifs et forfaits actuels, sans case d’activation ni recharge obligatoire. Le contrat décrit le service sans fixer de prix permanent.' },
    pt: { title: 'Tarifas e propostas de adesão mais claras', message: 'Configure as tarifas vigentes do POS e SMS em Onboarding. O contrato é gerado a partir dos dados e da escolha do comerciante. O primeiro email apresenta as três modalidades do POS. Os SMS são uma ferramenta disponível de uso opcional, com recargas separadas: o processo explica as tarifas e os pacotes vigentes, sem caixa de ativação nem recarga obrigatória. O contrato descreve o serviço sem fixar um preço permanente.' },
  },
};

// Publish by replacing the prior closure announcement only once both services are available.
export const onboardingSignatureFirstAnnouncementDraft = {
  id: 'onboarding-payment-signature-2026-10', revision: 2, category: 'improvement', severity: 'info',
  title: 'Revisa, envía el correo y completa el alta con el pago',
  message: 'Desde la revisión de Onboarding, comprueba los datos, los documentos y el contrato generado y pulsa Enviar correo de pago. El comercio firma primero y paga después. Al confirmarse el cobro se prepara el alta y se envían automáticamente el acceso, el QR y las instrucciones.',
  detail: 'Los importes se recuperan de la elección del comercio. Los SMS siguen disponibles mediante recargas opcionales por separado. Los contratos anteriores conservan sus condiciones.',
  translations: {
    en: { title: 'Review, send the email and activate after payment', message: 'In Onboarding review, check the details, documents and generated contract, then send the payment email. The merchant signs first and pays next. Confirmed payment triggers activation and automatically sends access, the QR code and instructions.', detail: 'Amounts come from the merchant’s saved selection. SMS remains available through optional separate top-ups. Previous contracts retain their terms.' },
    it: { title: 'Verifica, invia l’email e attiva dopo il pagamento', message: 'Nella revisione di Onboarding, controlla dati, documenti e contratto generato, quindi invia l’email di pagamento. Il commerciante firma prima e paga dopo. La conferma del pagamento avvia l’attivazione e l’invio automatico di accesso, codice QR e istruzioni.', detail: 'Gli importi derivano dalla scelta salvata del commerciante. Gli SMS restano disponibili tramite ricariche facoltative separate. I contratti precedenti conservano le proprie condizioni.' },
    fr: { title: 'Vérifiez, envoyez l’email et activez après paiement', message: 'Dans la révision Onboarding, vérifiez les données, les documents et le contrat généré, puis envoyez l’email de paiement. Le commerçant signe avant de payer. La confirmation du paiement déclenche l’activation et l’envoi automatique de l’accès, du code QR et des instructions.', detail: 'Les montants proviennent du choix enregistré du commerçant. Les SMS restent disponibles via des recharges facultatives séparées. Les contrats précédents conservent leurs conditions.' },
    pt: { title: 'Reveja, envie o email e ative após o pagamento', message: 'Na revisão de Onboarding, confira os dados, documentos e contrato gerado e envie o email de pagamento. O comerciante assina primeiro e paga depois. A confirmação do pagamento inicia a ativação e o envio automático do acesso, código QR e instruções.', detail: 'Os valores vêm da escolha guardada do comerciante. Os SMS continuam disponíveis através de recargas opcionais separadas. Os contratos anteriores mantêm as suas condições.' },
  },
};

// Published after both services and the customer-selected rental tariff were verified.
export const onboardingRentalTermAnnouncementDraft = {
  id: 'onboarding-commercial-2026-10', revision: 2, category: 'improvement', severity: 'info',
  title: 'Elige el plazo de tu renting, hasta 36 meses',
  message: 'En las nuevas solicitudes puedes elegir el número de mensualidades del renting. La cuota se calcula con el precio del POS y el plazo elegido; verás la cuota y el total antes de enviar. El contrato y el primer pago conservan tu elección.',
  detail: 'El plazo empieza con la entrega operativa. El POS pasa a ser tuyo al finalizar el plazo elegido y completar todos los pagos, sin pago residual. Las solicitudes y contratos anteriores conservan sus condiciones.',
  translations: {
    en: { title: 'Choose your rental term, up to 36 months', message: 'New applications let you choose the number of monthly rental payments. The installment is calculated from the POS price and selected term; you can review it and the total before submitting. The contract and first payment keep your selection.', detail: 'The term starts when the POS is delivered ready for use. Ownership transfers after the selected term and all payments are complete, with no residual payment. Existing applications and contracts retain their terms.' },
    it: { title: 'Scegli la durata del noleggio, fino a 36 mesi', message: 'Nelle nuove richieste puoi scegliere il numero di rate mensili del noleggio. La rata si calcola dal prezzo del POS e dalla durata scelta; vedrai rata e totale prima dell’invio. Il contratto e il primo pagamento rispettano la tua scelta.', detail: 'Il periodo inizia dalla consegna operativa. Il POS diventa tuo al termine del periodo scelto e dopo tutti i pagamenti, senza importo residuo. Le richieste e i contratti precedenti conservano le proprie condizioni.' },
    fr: { title: 'Choisissez votre durée de location, jusqu’à 36 mois', message: 'Les nouvelles demandes permettent de choisir le nombre de mensualités. Le montant est calculé selon le prix du POS et la durée choisie ; vous voyez la mensualité et le total avant l’envoi. Le contrat et le premier paiement conservent votre choix.', detail: 'La durée commence à la livraison opérationnelle. Le POS vous appartient à la fin de la durée choisie et après tous les paiements, sans montant résiduel. Les demandes et contrats précédents conservent leurs conditions.' },
    pt: { title: 'Escolha o prazo do renting, até 36 meses', message: 'Nas novas candidaturas pode escolher o número de mensalidades do renting. A prestação é calculada com o preço do POS e o prazo escolhido; verá a prestação e o total antes de enviar. O contrato e o primeiro pagamento mantêm a sua escolha.', detail: 'O prazo começa na entrega operacional. O POS passa a ser seu no fim do prazo escolhido e após todos os pagamentos, sem valor residual. As candidaturas e contratos anteriores mantêm as suas condições.' },
  },
};

backofficeAnnouncements.push(...[
  { ...simpleBackofficeAccessAnnouncementDraft, publishedAt: '2026-10-06T10:35:24.201Z' }, storeReceptionAnnouncementDraft,
  { ...onboardingRentalTermAnnouncementDraft, publishedAt: '2026-10-06T10:05:47.000Z' }, { ...onboardingSignatureFirstAnnouncementDraft, publishedAt: '2026-10-06T09:54:15.000Z' },
  { ...onboardingEmailsAnnouncementDraft, publishedAt: '2026-10-06T09:54:15.000Z' },
].map(announcement => ({ ...announcement,
  publishedAt: announcement.publishedAt || '2026-10-05T09:50:00.000Z', expiresAt: '2027-01-05T09:50:00.000Z',
})));

backofficeAnnouncements.push({ ...onboardingDefaultsAnnouncementDraft,
  publishedAt: '2026-10-05T11:18:00.000Z', expiresAt: '2027-01-05T11:18:00.000Z',
});

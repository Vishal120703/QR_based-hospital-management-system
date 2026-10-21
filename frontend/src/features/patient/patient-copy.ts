// What the patient page says, in English and Hindi, and how it shows times.

export type Language = 'en' | 'hi';
export const languageKey = 'careqr.patientLanguage';

export const copy = {
  en: {
    language: 'Language',
    scanAgain: 'Please scan the QR code on your bed to continue.',
    openScanner: 'Scan a QR code',
    noLogin:
      'No patient account or staff login is needed. Ask hospital staff for the bedside QR code if it is missing.',
    sessionEnded: 'Your session has ended.',
    loading: 'Loading your hospital services and requests…',
    tryAgain: 'Try again',
    dismiss: 'Dismiss',
    connected: 'You are connected to',
    room: 'Room',
    ward: 'Ward',
    floor: 'Floor',
    requestFor: (name: string) => `Request ${name}`,
    viewRequestFor: (name: string) => `View request for ${name}`,
    serviceCount: (count: number) => (count === 1 ? '1 service' : `${count} services`),
    showServices: (name: string) => `Show ${name} services`,
    hideServices: (name: string) => `Hide ${name} services`,
    showDetails: 'Show request details',
    hideDetails: 'Hide request details',
    urgentHint: 'Urgent? Press the nurse-call button or call any staff member.',
    emergencyTitle: 'Not for emergencies.',
    emergencyBody:
      'In a medical emergency, press the nurse-call button or tell any staff member immediately.',
    history: 'What happened',
    services: 'Hospital services',
    servicesHelp: 'Choose a service to send a request to hospital staff.',
    processingNotice:
      'Hospital staff are alerted to your request and a staff member is assigned to it, which can take a few minutes. For urgent help, tell hospital staff directly.',
    noServices: 'No services available yet',
    noServicesHelp:
      'The hospital has not published its service catalog. Please contact staff for assistance.',
    request: 'Request service',
    requesting: 'Sending…',
    viewRequest: 'View request',
    yourRequests: 'Your requests',
    requestsHelp:
      'Track requests from this bed stay. Status updates automatically while this page is open.',
    noRequests: 'No requests yet. Choose a service above to get started.',
    refresh: 'Refresh status',
    refreshing: 'Refreshing…',
    sent: 'Your request is ready to track below.',
    duplicate: 'An active request for this service already exists. Check your requests below.',
    uncertainSubmit:
      'We could not confirm whether your request was sent. Check your requests below before trying again.',
    submitFailed: 'We could not send the request. Please try again.',
    cancel: 'Cancel request',
    cancelQuestion: 'Cancel this request?',
    cancelWarning:
      'Hospital staff may already be responding. You can request the service again later if needed.',
    keepRequest: 'Keep request',
    confirmCancel: 'Yes, cancel request',
    cancelling: 'Cancelling…',
    cancelled: 'Your request was cancelled.',
    cancelChanged:
      'This request has changed and may no longer be cancellable. Please check its status.',
    cancelFailed: 'We could not cancel the request. Please check its status and try again.',
    submitted: 'Sent',
    reference: 'Reference',
    sessionUntil: 'This page stays connected until',
    requestStatus: {
      SUBMITTED: 'Submitted',
      ASSIGNED: 'Assigned',
      ACCEPTED: 'Accepted',
      IN_PROGRESS: 'In progress',
      COMPLETED: 'Completed',
      CLOSED: 'Closed',
      CANCELLED: 'Cancelled',
      REJECTED: 'Rejected',
    },
  },
  hi: {
    language: 'भाषा',
    scanAgain: 'जारी रखने के लिए अपने बिस्तर पर लगा QR कोड फिर से स्कैन करें।',
    openScanner: 'QR कोड स्कैन करें',
    noLogin:
      'मरीज के लिए खाता या कर्मचारी लॉगिन ज़रूरी नहीं है। बिस्तर पर QR कोड न हो तो अस्पताल के कर्मचारियों से पूछें।',
    sessionEnded: 'आपका सत्र समाप्त हो गया है।',
    loading: 'अस्पताल की सेवाएँ और अनुरोध लोड हो रहे हैं…',
    tryAgain: 'फिर कोशिश करें',
    dismiss: 'बंद करें',
    connected: 'आप यहाँ जुड़े हैं',
    room: 'कमरा',
    ward: 'वार्ड',
    floor: 'मंज़िल',
    requestFor: (name: string) => `${name} का अनुरोध करें`,
    viewRequestFor: (name: string) => `${name} का अनुरोध देखें`,
    serviceCount: (count: number) => (count === 1 ? '1 सेवा' : `${count} सेवाएँ`),
    showServices: (name: string) => `${name} सेवाएँ दिखाएँ`,
    hideServices: (name: string) => `${name} सेवाएँ छिपाएँ`,
    showDetails: 'अनुरोध का विवरण देखें',
    hideDetails: 'अनुरोध का विवरण छिपाएँ',
    urgentHint: 'तुरंत मदद चाहिए? नर्स-कॉल बटन दबाएँ या किसी भी कर्मचारी को बुलाएँ।',
    emergencyTitle: 'आपातकाल के लिए नहीं।',
    emergencyBody: 'चिकित्सा आपातकाल में नर्स-कॉल बटन दबाएँ या तुरंत किसी कर्मचारी को बताएँ।',
    history: 'अब तक क्या हुआ',
    services: 'अस्पताल की सेवाएँ',
    servicesHelp: 'अस्पताल के कर्मचारियों को अनुरोध भेजने के लिए सेवा चुनें।',
    processingNotice:
      'आपके अनुरोध की सूचना अस्पताल के कर्मचारियों को मिलती है और इसे एक कर्मचारी को सौंपा जाता है, जिसमें कुछ मिनट लग सकते हैं। तुरंत मदद के लिए सीधे अस्पताल के कर्मचारी को बताएँ।',
    noServices: 'अभी कोई सेवा उपलब्ध नहीं है',
    noServicesHelp:
      'अस्पताल ने अभी सेवाएँ प्रकाशित नहीं की हैं। मदद के लिए कर्मचारी से संपर्क करें।',
    request: 'सेवा का अनुरोध करें',
    requesting: 'भेजा जा रहा है…',
    viewRequest: 'अनुरोध देखें',
    yourRequests: 'आपके अनुरोध',
    requestsHelp:
      'इस बिस्तर पर रहने के दौरान भेजे गए अनुरोध देखें। पेज खुला रहने पर स्थिति अपने-आप अपडेट होती है।',
    noRequests: 'अभी कोई अनुरोध नहीं है। ऊपर से कोई सेवा चुनें।',
    refresh: 'स्थिति अपडेट करें',
    refreshing: 'अपडेट हो रहा है…',
    sent: 'आपका अनुरोध नीचे देखा जा सकता है।',
    duplicate: 'इस सेवा का एक सक्रिय अनुरोध पहले से है। नीचे अपने अनुरोध देखें।',
    uncertainSubmit:
      'अनुरोध भेजा गया या नहीं, इसकी पुष्टि नहीं हो सकी। दोबारा कोशिश करने से पहले नीचे अपने अनुरोध देखें।',
    submitFailed: 'अनुरोध नहीं भेजा जा सका। कृपया फिर कोशिश करें।',
    cancel: 'अनुरोध रद्द करें',
    cancelQuestion: 'क्या यह अनुरोध रद्द करना है?',
    cancelWarning:
      'अस्पताल के कर्मचारी जवाब देना शुरू कर चुके हो सकते हैं। ज़रूरत हो तो आप बाद में फिर अनुरोध कर सकते हैं।',
    keepRequest: 'अनुरोध बनाए रखें',
    confirmCancel: 'हाँ, अनुरोध रद्द करें',
    cancelling: 'रद्द हो रहा है…',
    cancelled: 'आपका अनुरोध रद्द कर दिया गया है।',
    cancelChanged:
      'इस अनुरोध की स्थिति बदल गई है और शायद इसे रद्द नहीं किया जा सकता। कृपया स्थिति देखें।',
    cancelFailed: 'अनुरोध रद्द नहीं हो सका। स्थिति देखें और फिर कोशिश करें।',
    submitted: 'भेजा गया',
    reference: 'संदर्भ संख्या',
    sessionUntil: 'यह पेज इस समय तक जुड़ा रहेगा',
    requestStatus: {
      SUBMITTED: 'भेजा गया',
      ASSIGNED: 'कर्मचारी नियुक्त',
      ACCEPTED: 'स्वीकार किया गया',
      IN_PROGRESS: 'काम जारी है',
      COMPLETED: 'पूरा हुआ',
      CLOSED: 'बंद',
      CANCELLED: 'रद्द',
      REJECTED: 'अस्वीकृत',
    },
  },
} as const;

// The text for one language.
export type PatientText = (typeof copy)[Language];

export function requestTime(value: string, language: Language): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        // Hindi readers get a 24-hour clock instead of a Latin "am/pm".
        ...(language === 'hi' ? { hourCycle: 'h23' as const } : {}),
      });
}

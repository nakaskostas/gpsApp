# gpsApp

## Οδηγίες για την αλλαγή των API Keys

Για να χρησιμοποιήσετε τα δικά σας API keys για τις υπηρεσίες Graphhopper και Openrouteservice, ακολουθήστε τα παρακάτω βήματα:

1.  Ανοίξτε το αρχείο `index.html`.
2.  Βρείτε το τμήμα `<script>` στο τέλος του αρχείου ή κάντε αναζήτηση την λέξη "CONFIG".
3.  Μέσα στο αντικείμενο `CONFIG`, θα βρείτε τις παρακάτω μεταβλητές:
    *   `OPENROUTE_API_KEY`: Αντικαταστήστε την υπάρχουσα τιμή με το δικό σας API key για το Openrouteservice.
    *   `GRAPHHOPPER_KEY`: Αντικαταστήστε την υπάρχουσα τιμή με το δικό σας API key για το Graphhopper.

**Παράδειγμα:**

```javascript
const CONFIG = {
    OPENROUTE_API_KEY: 'ΤΟ_ΔΙΚΟ_ΣΑΣ_OPENROUTE_API_KEY',
    GRAPHHOPPER_KEY: 'ΤΟ_ΔΙΚΟ_ΣΑΣ_GRAPHHOPPER_KEY',
    ELEVATION_API_URL: 'https://api.open-elevation.com/api/v1/lookup',
    
    // ... άλλες ρυθμίσεις
};
```

**Σημείωση:** Βεβαιωθείτε ότι έχετε κάνει εγγραφή στις αντίστοιχες υπηρεσίες για να αποκτήσετε τα API keys.

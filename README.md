# Schowek na telefon

Przesyłanie tekstu i obrazów z komputera na telefon za pomocą kodu QR. Aplikacja nie korzysta z serwera w internecie.

## Uruchomienie na Windows

1. Otwórz dwuklikiem plik `Uruchom.bat`. Wymagany jest Node.js 18 lub nowszy.
2. Program otworzy stronę w przeglądarce. **Nie zamykaj okna programu** podczas przesyłania — jego zamknięcie zatrzymuje serwer.
3. Połącz telefon i komputer z tą samą siecią lokalną, np. z tym samym Wi-Fi.

Jeśli Windows zapyta o dostęp przez zaporę sieciową, zezwól na dostęp w **sieciach prywatnych**. Jeśli telefon nie może otworzyć linku, sprawdź wybrany adres komputera w aplikacji, zaporę sieciową oraz to, czy sieć Wi-Fi nie izoluje urządzeń od siebie.

## Tekst przez Wi-Fi

1. Wybierz **Tekst** i **Przez Wi-Fi**.
2. Wklej tekst i kliknij **Utwórz kod Wi-Fi**.
3. Zeskanuj kod telefonem, otwórz link i wybierz **Kopiuj tekst**. Jeśli telefon nie pozwoli na automatyczne kopiowanie po naciśnięciu przycisku, użyj polecenia **Kopiuj** w menu zaznaczonego tekstu.

Limit tekstu przez Wi-Fi wynosi 1 MiB (1 048 576 bajtów UTF-8).

## Obraz przez Wi-Fi

1. Wybierz **Obraz**. Wklej go przyciskiem, za pomocą **Ctrl+V**, przeciągnij plik lub kliknij **Wybierz plik**.
2. Zeskanuj kod telefonem i otwórz link.
3. Wybierz **Pobierz obraz** lub przytrzymaj go na telefonie, aby skorzystać z dostępnych opcji. Możliwość skopiowania obrazu do schowka zależy od telefonu i przeglądarki.

Obsługiwane są PNG, JPG, GIF i WebP do 15 MiB (15 728 640 bajtów).

## Bezpośredni kod QR z tekstem

W zakładce **Tekst** można też wybrać **Bezpośredni kod QR**. Kod zawiera wtedy sam tekst i nie wymaga sieci ani serwera. Można korzystać z tego trybu, otwierając bezpośrednio `index.html` w Chrome lub Edge. Jeden kod mieści maksymalnie 2952 bajty UTF-8; polskie litery i emoji zajmują więcej niż jeden bajt.

Zeskanuj kod aplikacją obsługującą tekst, np. Google Lens, a następnie wybierz w niej **Kopiuj tekst**. Samo skanowanie nie zapisuje tekstu w schowku telefonu.

## Prywatność

Tekst i obraz udostępniane przez Wi-Fi są przechowywane tylko w pamięci uruchomionego programu. Link zawiera losowy identyfikator i wygasa po 15 minutach. Wyczyszczenie zawartości usuwa link z programu; jeśli usunięcie nie może zostać potwierdzone, aplikacja wyświetla ostrzeżenie. Zamknięcie programu zawsze przerywa dostęp. Każda osoba w sieci, która zdobędzie link lub zeskanuje kod, może jednak otworzyć zawartość.

Połączenie przez lokalną sieć nie jest szyfrowane. **Nie przesyłaj poufnych danych w niezaufanej ani publicznej sieci Wi-Fi.** Skaner kodów QR użyty na telefonie może mieć własne zasady dotyczące danych.

## Testy

Testy serwera można uruchomić poleceniem `node --test tests/server.test.cjs`.

## Biblioteka

Generowanie kodów QR: [QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library) autorstwa Project Nayuki. Biblioteka znajduje się w `vendor/qrcodegen.js`; jej licencja MIT jest dołączona do pliku.

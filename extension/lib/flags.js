(function (root) {
  const KEYWORDS = [
    ["финляндия", "fi"], ["finland", "fi"],
    ["германия", "de"], ["germany", "de"], ["deutsch", "de"],
    ["литва", "lt"], ["lithuania", "lt"], ["litva", "lt"],
    ["турция", "tr"], ["turkey", "tr"], ["türkiye", "tr"],
    ["нидерланды", "nl"], ["holland", "nl"], ["голланд", "nl"], ["netherlands", "nl"],
    ["великобритан", "gb"], ["britain", "gb"], ["england", "gb"], ["англия", "gb"], ["london", "gb"],
    ["соединенн", "us"], ["america", "us"], ["сша", "us"],
    ["франц", "fr"], ["france", "fr"],
    ["польш", "pl"], ["poland", "pl"],
    ["латвия", "lv"], ["latvia", "lv"],
    ["эстония", "ee"], ["estonia", "ee"],
    ["швец", "se"], ["sweden", "se"],
    ["норвег", "no"], ["norway", "no"],
    ["австрал", "au"], ["australia", "au"],
    ["австр", "at"], ["austria", "at"],
    ["швейцар", "ch"], ["switzerland", "ch"],
    ["итал", "it"], ["italy", "it"],
    ["испан", "es"], ["spain", "es"],
    ["чехи", "cz"], ["czech", "cz"],
    ["румын", "ro"], ["romania", "ro"],
    ["молдав", "md"], ["moldova", "md"],
    ["украин", "ua"], ["ukraine", "ua"],
    ["казах", "kz"], ["kazakhstan", "kz"],
    ["грузи", "ge"], ["georgia", "ge"],
    ["оаэ", "ae"], ["дуба", "ae"], ["emirates", "ae"],
    ["сингапур", "sg"], ["singapore", "sg"],
    ["япон", "jp"], ["japan", "jp"],
    ["корея", "kr"], ["korea", "kr"],
    ["индия", "in"], ["india", "in"],
    ["бразил", "br"], ["brazil", "br"],
    ["канад", "ca"], ["canada", "ca"],
    ["бельг", "be"], ["belgium", "be"],
    ["португал", "pt"], ["portugal", "pt"],
    ["грец", "gr"], ["greece", "gr"],
    ["болгар", "bg"], ["bulgaria", "bg"],
    ["венгр", "hu"], ["hungary", "hu"],
    ["ирланд", "ie"], ["ireland", "ie"],
    ["исланд", "is"], ["iceland", "is"],
    ["дания", "dk"], ["датск", "dk"], ["denmark", "dk"],
    ["израил", "il"], ["israel", "il"],
    ["гонконг", "hk"], ["hong kong", "hk"],
    ["тайван", "tw"], ["taiwan", "tw"],
    ["таиланд", "th"], ["тайланд", "th"], ["thailand", "th"],
    ["вьетнам", "vn"], ["vietnam", "vn"],
    ["индонез", "id"], ["indonesia", "id"],
    ["малайз", "my"], ["malaysia", "my"],
    ["филиппин", "ph"], ["philippines", "ph"],
    ["мексик", "mx"], ["mexico", "mx"],
    ["аргентин", "ar"], ["argentina", "ar"],
    ["россия", "ru"], ["russia", "ru"],
    ["гваделуп", "gp"],
    ["авто", "gp"],
  ];

  const HOSTS = [
    ["finland", "fi"], ["germany", "de"], ["litva", "lt"], ["lithuania", "lt"],
    ["turkey", "tr"], ["netherlands", "nl"], ["london", "gb"], ["france", "fr"],
    ["poland", "pl"], ["sweden", "se"], ["austria", "at"], ["italy", "it"],
    ["spain", "es"], ["ukraine", "ua"], ["singapore", "sg"], ["japan", "jp"],
    ["canada", "ca"], ["australia", "au"], ["hongkong", "hk"], ["dubai", "ae"],
  ];

  function fromEmoji(text) {
    const chars = Array.from(String(text || ""));
    for (let i = 0; i < chars.length - 1; i += 1) {
      const a = chars[i].codePointAt(0);
      const b = chars[i + 1].codePointAt(0);
      if (a >= 0x1F1E6 && a <= 0x1F1FF && b >= 0x1F1E6 && b <= 0x1F1FF) {
        return String.fromCharCode(a - 0x1F1E6 + 65, b - 0x1F1E6 + 65).toLowerCase();
      }
    }
    return "";
  }

  function fromText(text) {
    const hay = String(text || "").toLowerCase();
    if (/осталось|days left|expire/i.test(hay)) return "info";
    for (const [key, code] of KEYWORDS) {
      if (hay.includes(key)) return code;
    }
    return "";
  }

  function fromHost(host) {
    const hay = String(host || "").toLowerCase();
    for (const [key, code] of HOSTS) {
      if (hay.includes(key)) return code;
    }
    return "";
  }

  function countryCode(node) {
    return fromEmoji(node?.name) || fromText(node?.name) || fromHost(node?.server) || "xx";
  }

  function stripFlagEmoji(name) {
    return String(name || "")
      .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function svg(code) {
    const c = String(code || "xx").toLowerCase();
    const inner = innerSvg(c);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 6" class="flag-svg">${inner}</svg>`;
  }

  function rect(x, y, w, h, fill) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  }

  function horiz(colors) {
    const h = 6 / colors.length;
    return colors.map((color, i) => rect(0, i * h, 9, h + 0.02, color)).join("");
  }

  function vert(colors) {
    const w = 9 / colors.length;
    return colors.map((color, i) => rect(i * w, 0, w + 0.02, 6, color)).join("");
  }

  function nordic(bg, cross) {
    return rect(0, 0, 9, 6, bg)
      + rect(0, 2.25, 9, 1.5, cross)
      + rect(2.4, 0, 1.5, 6, cross);
  }

  function innerSvg(code) {
    switch (code) {
      case "fi": return nordic("#fff", "#003580");
      case "se": return nordic("#006AA7", "#FECC00");
      case "no": return nordic("#BA0C2F", "#fff") + rect(2.7, 0, 0.9, 6, "#00205B") + rect(0, 2.55, 9, 0.9, "#00205B");
      case "dk": return nordic("#C8102E", "#fff");
      case "is": return nordic("#02529C", "#fff") + rect(2.7, 0, 0.9, 6, "#DC1E35") + rect(0, 2.55, 9, 0.9, "#DC1E35");
      case "de": return horiz(["#000", "#DD0000", "#FFCE00"]);
      case "lt": return horiz(["#FDB913", "#006A44", "#C1272D"]);
      case "ee": return horiz(["#0072CE", "#000", "#fff"]);
      case "ru": return horiz(["#fff", "#0039A6", "#D52B1E"]);
      case "nl": return horiz(["#AE1C28", "#fff", "#21468B"]);
      case "lu": return horiz(["#ED2939", "#fff", "#00A3E0"]);
      case "hu": return horiz(["#C8102E", "#fff", "#00843D"]);
      case "bg": return horiz(["#fff", "#00966E", "#D62612"]);
      case "at": return horiz(["#ED2939", "#fff", "#ED2939"]);
      case "ua": return horiz(["#0057B8", "#FFD700"]);
      case "pl": return horiz(["#fff", "#DC143C"]);
      case "id": return horiz(["#FF0000", "#fff"]);
      case "fr": return vert(["#002395", "#fff", "#ED2939"]);
      case "it": return vert(["#009246", "#fff", "#CE2B37"]);
      case "ie": return vert(["#169B62", "#fff", "#FF883E"]);
      case "be": return vert(["#000", "#FAE042", "#ED2939"]);
      case "ro": return vert(["#002B7F", "#FCD116", "#CE1126"]);
      case "md": return vert(["#003DA5", "#FFD200", "#CC092F"]);
      case "tr": return rect(0, 0, 9, 6, "#E30A17") + `<circle cx="3.3" cy="3" r="1.35" fill="#fff"/><circle cx="3.65" cy="3" r="1.05" fill="#E30A17"/><path fill="#fff" d="M5.7 3l-.85.28.5-.75-.5-.75.85.28.33-.82.33.82.85-.28-.5.75.5.75-.85-.28-.33.82z"/>`;
      case "jp": return rect(0, 0, 9, 6, "#fff") + `<circle cx="4.5" cy="3" r="1.45" fill="#BC002D"/>`;
      case "ch": return rect(0, 0, 9, 6, "#FF0000") + rect(3.7, 1.3, 1.6, 3.4, "#fff") + rect(2.4, 2.2, 4.2, 1.6, "#fff");
      case "gb": return rect(0, 0, 9, 6, "#012169") + `<path d="M0 0l9 6M9 0L0 6" stroke="#fff" stroke-width="1.2"/><path d="M0 0l9 6M9 0L0 6" stroke="#C8102E" stroke-width=".5"/><path d="M4.5 0v6M0 3h9" stroke="#fff" stroke-width="2"/><path d="M4.5 0v6M0 3h9" stroke="#C8102E" stroke-width="1.1"/>`;
      case "us": return rect(0, 0, 9, 6, "#B31942") + Array.from({ length: 6 }, (_, i) => rect(0, 0.5 + i, 9, 0.5, "#fff")).join("") + rect(0, 0, 3.6, 3.2, "#0A3161");
      case "ca": return vert(["#FF0000", "#fff", "#FF0000"]) + `<path fill="#FF0000" d="M4.5 1.2l.35 1.1 1.15-.1-.9.75.3 1.1L4.5 3.5 3.6 4.05l.3-1.1-.9-.75 1.15.1z"/>`;
      case "au": return rect(0, 0, 9, 6, "#012169") + `<path d="M0 0l4.5 3M4.5 0L0 3" stroke="#fff" stroke-width=".5"/>`;
      case "kz": return rect(0, 0, 9, 6, "#00AFCA") + `<circle cx="4.5" cy="3" r="1.2" fill="#FEC50C"/>`;
      case "ge": return rect(0, 0, 9, 6, "#fff") + rect(0, 2.4, 9, 1.2, "#FF0000") + rect(3.9, 0, 1.2, 6, "#FF0000");
      case "ae": return horiz(["#00732F", "#fff", "#000"]) + rect(0, 0, 2.2, 6, "#FF0000");
      case "sg": return horiz(["#EF3340", "#fff"]) + `<circle cx="1.6" cy="1.5" r=".7" fill="#fff"/>`;
      case "kr": return rect(0, 0, 9, 6, "#fff") + `<circle cx="4.5" cy="3" r="1.2" fill="#CD2E3A"/>`;
      case "in": return horiz(["#FF9933", "#fff", "#138808"]) + `<circle cx="4.5" cy="3" r=".7" fill="none" stroke="#000088" stroke-width=".2"/>`;
      case "br": return rect(0, 0, 9, 6, "#009C3B") + `<polygon points="4.5,0.7 8.2,3 4.5,5.3 0.8,3" fill="#FFDF00"/>` + `<circle cx="4.5" cy="3" r=".9" fill="#002776"/>`;
      case "es": return horiz(["#AA151B", "#F1BF00", "#AA151B"]);
      case "cz": return rect(0, 0, 9, 6, "#fff") + rect(0, 3, 9, 3, "#D7141A") + `<polygon points="0,0 4.2,3 0,6" fill="#11457E"/>`;
      case "pt": return rect(0, 0, 3.2, 6, "#006600") + rect(3.2, 0, 5.8, 6, "#FF0000");
      case "gr": return rect(0, 0, 9, 6, "#0D5EAF") + Array.from({ length: 4 }, (_, i) => rect(0, 0.67 + i * 1.33, 9, 0.67, "#fff")).join("");
      case "il": return rect(0, 0, 9, 6, "#fff") + rect(0, 0.7, 9, 0.7, "#0038B8") + rect(0, 4.6, 9, 0.7, "#0038B8");
      case "lv": return horiz(["#9E3039", "#fff", "#9E3039"]);
      case "gp": return rect(0, 0, 9, 6, "#000091") + `<polygon points="4.5,1 8,5.4 1,5.4" fill="#E1000F"/>`;
      case "hk": return rect(0, 0, 9, 6, "#DE2910") + `<circle cx="4.5" cy="3" r="1.1" fill="#fff"/>`;
      case "tw": return rect(0, 0, 9, 6, "#FE0000") + rect(0, 0, 4.2, 3.2, "#000095") + `<circle cx="2.1" cy="1.6" r=".7" fill="#fff"/>`;
      case "th": return horiz(["#A51931", "#F4F5F8", "#2D2A4A", "#F4F5F8", "#A51931"]);
      case "vn": return rect(0, 0, 9, 6, "#DA251D") + `<path fill="#FF0" d="M4.5 1.3l.4 1.2h1.3l-1 .8.4 1.2-1.1-.8-1.1.8.4-1.2-1-.8h1.3z"/>`;
      case "ph": return rect(0, 0, 9, 3, "#0038A8") + rect(0, 3, 9, 3, "#CE1126") + `<polygon points="0,0 3.4,3 0,6" fill="#fff"/>`;
      case "mx": return vert(["#006847", "#fff", "#CE1126"]);
      case "ar": return horiz(["#74ACDF", "#fff", "#74ACDF"]);
      case "info": return rect(0, 0, 9, 6, "#2A2450") + `<circle cx="4.5" cy="3" r="1.6" fill="#8B7CFF"/><rect x="4.15" y="2.4" width=".7" height="1.8" rx=".2" fill="#fff"/><circle cx="4.5" cy="1.95" r=".28" fill="#fff"/>`;
      default: return rect(0, 0, 9, 6, "#2A2A38") + `<circle cx="4.5" cy="3" r="1.7" fill="none" stroke="#8B8B9A" stroke-width=".35"/><path d="M4.5 1.3c1.1 1 1.1 2.7 0 3.7M4.5 1.3c-1.1 1-1.1 2.7 0 3.7M2.8 3h3.4" stroke="#8B8B9A" stroke-width=".35" fill="none"/>`;
    }
  }

  function markup(node) {
    const code = countryCode(node);
    return `<span class="flag" title="${code.toUpperCase()}">${svg(code)}</span>`;
  }

  root.StarlitFlags = { countryCode, stripFlagEmoji, markup, svg };
})(globalThis);

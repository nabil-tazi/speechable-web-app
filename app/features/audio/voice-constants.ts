import type { UnifiedVoices } from "./voice-types";

export const unifiedVoices = {
  // English voices (combining American and British)
  en: [
    // American English voices
    {
      name: "heart",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_heart",
        lemonfox: "heart",
      },
      traits: "❤️",
      quality: {
        target: "A",
        training: "HH hours",
        overall: "A",
      },
    },
    {
      name: "alloy",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_alloy",
        lemonfox: "alloy",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
    {
      name: "aoede",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_aoede",
        lemonfox: "aoede",
      },
      quality: {
        target: "B",
        training: "H hours",
        overall: "C+",
      },
    },
    {
      name: "bella",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_bella",
        lemonfox: "bella",
      },
      traits: "🔥",
      quality: {
        target: "A",
        training: "HH hours",
        overall: "A-",
      },
    },
    {
      name: "jessica",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_jessica",
        lemonfox: "jessica",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "kore",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_kore",
        lemonfox: "kore",
      },
      quality: {
        target: "B",
        training: "H hours",
        overall: "C+",
      },
    },
    {
      name: "nicole",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_nicole",
        lemonfox: "nicole",
      },
      traits: "🎧",
      quality: {
        target: "B",
        training: "HH hours",
        overall: "B-",
      },
    },
    {
      name: "nova",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_nova",
        lemonfox: "nova",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
    {
      name: "river",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_river",
        lemonfox: "river",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "sarah",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_sarah",
        lemonfox: "sarah",
      },
      quality: {
        target: "B",
        training: "H hours",
        overall: "C+",
      },
    },
    {
      name: "sky",
      gender: "female",
      accent: "us",
      models: {
        kokoro: "af_sky",
        lemonfox: "sky",
      },
      quality: {
        target: "B",
        training: "M minutes",
        overall: "C-",
      },
    },
    {
      name: "adam",
      gender: "male",
      accent: "us",
      models: {
        kokoro: "am_adam",
        lemonfox: "adam",
      },
      quality: {
        target: "D",
        training: "H hours",
        overall: "F+",
      },
    },
    {
      name: "echo",
      gender: "male",
      accent: "us",
      models: {
        kokoro: "am_echo",
        lemonfox: "echo",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "eric",
      gender: "male",
      accent: "us",
      models: {
        kokoro: "am_eric",
        lemonfox: "eric",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "fenrir",
      gender: "male",
      accent: "us",
      models: {
        kokoro: "am_fenrir",
        lemonfox: "fenrir",
      },
      quality: {
        target: "B",
        training: "H hours",
        overall: "C+",
      },
    },
    {
      name: "liam",
      gender: "male",
      accent: "us",
      models: {
        kokoro: "am_liam",
        lemonfox: "liam",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "michael",
      gender: "male",
      accent: "us",
      models: {
        kokoro: "am_michael",
        lemonfox: "michael",
      },
      quality: {
        target: "B",
        training: "H hours",
        overall: "C+",
      },
    },
    {
      name: "onyx",
      gender: "male",
      accent: "us",
      models: {
        kokoro: "am_onyx",
        lemonfox: "onyx",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "puck",
      gender: "male",
      accent: "us",
      models: {
        kokoro: "am_puck",
        lemonfox: "puck",
      },
      quality: {
        target: "B",
        training: "H hours",
        overall: "C+",
      },
    },
    {
      name: "santa",
      gender: "male",
      accent: "us",
      models: {
        kokoro: "am_santa",
        lemonfox: "santa",
      },
      quality: {
        target: "C",
        training: "M minutes",
        overall: "D-",
      },
    },
    // British English voices
    {
      name: "alice",
      gender: "female",
      accent: "gb",
      models: {
        kokoro: "bf_alice",
        lemonfox: "alice",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "emma",
      gender: "female",
      accent: "gb",
      models: {
        kokoro: "bf_emma",
        lemonfox: "emma",
      },
      quality: {
        target: "B",
        training: "HH hours",
        overall: "B-",
      },
    },
    {
      name: "isabella",
      gender: "female",
      accent: "gb",
      models: {
        kokoro: "bf_isabella",
        lemonfox: "isabella",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
    {
      name: "lily",
      gender: "female",
      accent: "gb",
      models: {
        kokoro: "bf_lily",
        lemonfox: "lily",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "daniel",
      gender: "male",
      accent: "gb",
      models: {
        kokoro: "bm_daniel",
        lemonfox: "daniel",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "fable",
      gender: "male",
      accent: "gb",
      models: {
        kokoro: "bm_fable",
        lemonfox: "fable",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
    {
      name: "george",
      gender: "male",
      accent: "gb",
      models: {
        kokoro: "bm_george",
        lemonfox: "george",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
    {
      name: "lewis",
      gender: "male",
      accent: "gb",
      models: {
        kokoro: "bm_lewis",
        lemonfox: "lewis",
      },
      quality: {
        target: "C",
        training: "H hours",
        overall: "D+",
      },
    },
  ],

  // Japanese voices
  ja: [
    {
      name: "alpha",
      gender: "female",
      models: {
        kokoro: "jf_alpha",
        lemonfox: "sakura",
      },
      quality: {
        target: "B",
        training: "H hours",
        overall: "C+",
      },
    },
    {
      name: "gongitsune",
      gender: "female",
      models: {
        kokoro: "jf_gongitsune",
        lemonfox: "gongitsune",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
      source: "gongitsune story",
    },
    {
      name: "nezumi",
      gender: "female",
      models: {
        kokoro: "jf_nezumi",
        lemonfox: "nezumi",
      },
      quality: {
        target: "B",
        training: "M minutes",
        overall: "C-",
      },
      source: "nezuminoyomeiri story",
    },
    // {
    //   name: "sakura",
    //   gender: "female",
    //   models: {
    //     kokoro: null,
    //     lemonfox: "sakura",
    //   },
    // },
    {
      name: "tebukuro",
      gender: "female",
      models: {
        kokoro: "jf_tebukuro",
        lemonfox: "tebukuro",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
      source: "tebukurowokaini story",
    },
    {
      name: "kumo",
      gender: "male",
      models: {
        kokoro: "jm_kumo",
        lemonfox: "kumo",
      },
      quality: {
        target: "B",
        training: "M minutes",
        overall: "C-",
      },
      source: "kumonoito story",
    },
  ],

  // Chinese voices
  zh: [
    {
      name: "xiaobei",
      gender: "female",
      models: {
        kokoro: "zf_xiaobei",
        lemonfox: "xiaobei",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "xiaoni",
      gender: "female",
      models: {
        kokoro: "zf_xiaoni",
        lemonfox: "xiaoni",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "xiaoxiao",
      gender: "female",
      models: {
        kokoro: "zf_xiaoxiao",
        lemonfox: "xiaoxiao",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "xiaoyi",
      gender: "female",
      models: {
        kokoro: "zf_xiaoyi",
        lemonfox: "xiaoyi",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "yunjian",
      gender: "male",
      models: {
        kokoro: "zm_yunjian",
        lemonfox: "yunjian",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "yunxi",
      gender: "male",
      models: {
        kokoro: "zm_yunxi",
        lemonfox: "yunxi",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "yunxia",
      gender: "male",
      models: {
        kokoro: "zm_yunxia",
        lemonfox: "yunxia",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
    {
      name: "yunyang",
      gender: "male",
      models: {
        kokoro: "zm_yunyang",
        lemonfox: "yunyang",
      },
      quality: {
        target: "C",
        training: "MM minutes",
        overall: "D",
      },
    },
  ],

  // Spanish voices
  es: [
    {
      name: "dora",
      gender: "female",
      models: {
        kokoro: "ef_dora",
        lemonfox: "dora",
      },
    },
    {
      name: "alex",
      gender: "male",
      models: {
        kokoro: "em_alex",
        lemonfox: "alex",
      },
    },
    {
      name: "noel",
      gender: "male",
      models: {
        kokoro: "em_santa",
        lemonfox: "noel",
      },
    },
    // {
    //   name: "santa",
    //   gender: "male",
    //   models: {
    //     kokoro: "em_santa",
    //     lemonfox: null,
    //   },
    // },
  ],

  // French voices
  fr: [
    {
      name: "siwis",
      gender: "female",
      models: {
        kokoro: "ff_siwis",
        lemonfox: "siwis",
      },
      quality: {
        target: "B",
        training: "<11 hours",
        overall: "B-",
      },
      source: "SIWIS dataset",
    },
  ],

  // Hindi voices
  hi: [
    {
      name: "alpha",
      gender: "female",
      models: {
        kokoro: "hf_alpha",
        lemonfox: "alpha",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
    {
      name: "beta",
      gender: "female",
      models: {
        kokoro: "hf_beta",
        lemonfox: "beta",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
    {
      name: "omega",
      gender: "male",
      models: {
        kokoro: "hm_omega",
        lemonfox: "omega",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
    {
      name: "psi",
      gender: "male",
      models: {
        kokoro: "hm_psi",
        lemonfox: "psi",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
  ],

  // Italian voices
  it: [
    {
      name: "sara",
      gender: "female",
      models: {
        kokoro: "if_sara",
        lemonfox: "sara",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
    {
      name: "nicola",
      gender: "male",
      models: {
        kokoro: "im_nicola",
        lemonfox: "nicola",
      },
      quality: {
        target: "B",
        training: "MM minutes",
        overall: "C",
      },
    },
  ],

  // Portuguese (Brazil) voices
  pt: [
    // {
    //   name: "clara",
    //   gender: "female",
    //   accent: "br",
    //   models: {
    //     kokoro: null,
    //     lemonfox: "clara",
    //   },
    // },
    {
      name: "dora",
      gender: "female",
      accent: "br",
      models: {
        kokoro: "pf_dora",
        lemonfox: "clara",
      },
    },
    {
      name: "alex",
      gender: "male",
      accent: "br",
      models: {
        kokoro: "pm_alex",
        lemonfox: "tiago",
      },
    },
    // {
    //   name: "papai",
    //   gender: "male",
    //   accent: "br",
    //   models: {
    //     kokoro: null,
    //     lemonfox: "papai",
    //   },
    // },
    {
      name: "papai",
      gender: "male",
      accent: "br",

      models: {
        kokoro: "pm_santa",
        lemonfox: "papai",
      },
    },
    // {
    //   name: "tiago",
    //   gender: "male",
    //   accent: "br",
    //   models: {
    //     kokoro: null,
    //     lemonfox: "tiago",
    //   },
    // },
  ],
} as const satisfies UnifiedVoices;

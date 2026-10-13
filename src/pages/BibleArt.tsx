/** Gravuras da Bíblia: ilustrações clássicas de Gustave Doré (1866), domínio público, vindas do Wikimedia Commons.
 *  As imagens não ficam no app: cada uma é baixada só quando a pessoa abre o capítulo (o app continua leve). */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Images, X } from 'lucide-react';
import { bookByN, bookName, chapterPath, type Book, type VersionId } from '../lib/bible';
import { Seg, Sheet } from '../components/ui';
import './BibleArt.css';

/** [livro (1–66), capítulo, versículo, título, arquivo no Wikimedia Commons] */
type Art = [number, number, number, string, string];

const ART: Art[] = [
  [1, 1, 3, "A criação da luz", "001.The Creation of Light.jpg"],
  [1, 2, 22, "A criação de Eva", "002.The Creation of Eve.jpg"],
  [1, 3, 23, "Adão e Eva são expulsos do Éden", "003.Adam and Eve Are Driven out of Eden.jpg"],
  [1, 4, 3, "Caim e Abel oferecem sacrifícios", "004.Cain and Abel Offer Their Sacrifices.jpg"],
  [1, 4, 8, "Caim mata Abel", "005.Cain Slays Abel.jpg"],
  [1, 7, 21, "O mundo é destruído pelas águas", "006.The World Is Destroyed by Water.jpg"],
  [1, 7, 23, "O dilúvio", "007.The Great Flood.jpg"],
  [1, 8, 8, "A pomba é solta da arca", "008.A Dove Is Sent Forth from the Ark.jpg"],
  [1, 9, 25, "Noé amaldiçoa Cam e Canaã", "009.Noah Curses Ham and Canaan.jpg"],
  [1, 11, 4, "A torre de Babel", "010.The Tower of Babel.jpg"],
  [1, 12, 5, "Abraão parte para a terra de Canaã", "011.Abraham Goes to the Land of Canaan.jpg"],
  [1, 18, 2, "Abraão e os três anjos", "012.Abraham and the Three Angels.jpg"],
  [1, 19, 24, "Ló foge enquanto Sodoma e Gomorra queimam", "013.Lot Flees as Sodom and Gomorrah Burn.jpg"],
  [1, 21, 14, "Abraão despede Agar e Ismael", "014.Abraham Sends Hagar and Ishmael Away.jpg"],
  [1, 21, 17, "Agar e Ismael no deserto", "015.Hagar and Ishmael in the Wilderness.jpg"],
  [1, 22, 10, "A prova da fé de Abraão", "016.The Testing of Abraham's Faith.jpg"],
  [1, 23, 19, "O sepultamento de Sara", "017.The Burial of Sarah.jpg"],
  [1, 24, 17, "Eliézer e Rebeca junto ao poço", "018.Eliezer and Rebekah at the Well.jpg"],
  [1, 24, 64, "O encontro de Isaque e Rebeca", "019.The Meeting of Isaac and Rebekah.jpg"],
  [1, 27, 27, "Isaque abençoa Jacó", "020.Isaac Blesses Jacob.jpg"],
  [1, 28, 12, "O sonho de Jacó", "021.Jacob's Dream.jpg"],
  [1, 29, 10, "Jacó encontra Raquel", "022.Jacob Tends Laban's Flocks and Meets Rachel.jpg"],
  [1, 32, 9, "Jacó ora pedindo proteção", "023.Jacob Prays for Protection.jpg"],
  [1, 32, 24, "Jacó luta com o anjo", "024.Jacob Wrestles with the Angel.jpg"],
  [1, 33, 4, "O encontro de Jacó e Esaú", "025.Jacob and Esau Meet.jpg"],
  [1, 37, 28, "José é vendido pelos irmãos", "026.Joseph Is Sold by His Brothers.jpg"],
  [1, 41, 25, "José interpreta o sonho de Faraó", "027.Joseph Interprets Pharaoh's Dream.jpg"],
  [1, 45, 1, "José se revela aos irmãos", "028.Joseph Reveals Himself to His Brothers.jpg"],
  [1, 46, 5, "Jacó vai para o Egito", "029.Jacob Goes to Egypt.jpg"],
  [2, 2, 3, "O menino Moisés no rio Nilo", "030.The Child Moses on the Nile.jpg"],
  [2, 2, 5, "Moisés é encontrado no rio", "031.The Finding of Moses.jpg"],
  [2, 7, 10, "Moisés e Arão diante de Faraó", "032.Moses and Aaron Appear before Pharaoh.jpg"],
  [2, 9, 6, "A quinta praga: a peste nos animais", "033.The Fifth Plague. Livestock Disease.jpg"],
  [2, 10, 22, "A nona praga: as trevas", "034.The Ninth Plague. Darkness.jpg"],
  [2, 12, 29, "A morte dos primogênitos do Egito", "035.The Firstborn of the Egyptians Are Slain.jpg"],
  [2, 12, 31, "Os egípcios pedem que Moisés parta", "036.The Egyptians Ask Moses to Depart.jpg"],
  [2, 14, 27, "Os egípcios se afogam no mar", "037.The Egyptians Drown in the Sea.jpg"],
  [2, 17, 6, "Moisés fere a rocha em Horebe", "041.Moses Strikes the Rock at Horeb.jpg"],
  [2, 19, 18, "A entrega da Lei no monte Sinai", "038.The Giving of the Law on Mount Sinai.jpg"],
  [2, 32, 19, "Moisés quebra as tábuas da Lei", "041A.Moses Breaks the Tables of the Law.jpg"],
  [2, 34, 29, "Moisés desce do monte Sinai", "039.Moses Comes Down from Mount Sinai.jpg"],
  [4, 13, 23, "Os espias voltam da Terra Prometida", "041B.The Spies Return from the Promised Land.jpg"],
  [4, 16, 32, "A morte de Corá, Datã e Abirão", "040.The Death of Korah, Dathan, and Abiram.jpg"],
  [4, 21, 9, "A serpente de bronze", "042.The Bronze Serpent.jpg"],
  [4, 22, 31, "O anjo aparece a Balaão", "043.An Angel Appears to Balaam.jpg"],
  [6, 3, 17, "Os israelitas atravessam o Jordão", "044. The Israelites Cross the Jordan River.jpg"],
  [6, 5, 13, "Um anjo aparece aos israelitas", "045. An Angel Appears to the Israelites.jpg"],
  [6, 6, 20, "Os muros de Jericó caem", "046.The Walls of Jericho Fall Down.jpg"],
  [6, 6, 23, "Josué poupa Raabe", "047.Joshua Spares Rahab.jpg"],
  [6, 7, 25, "Acã é apedrejado", "048.Achan Is Stoned to Death.jpg"],
  [6, 8, 28, "Josué incendeia a cidade de Ai", "049.Joshua Burns the Town of Ai.jpg"],
  [6, 10, 11, "O exército dos amorreus é destruído", "050.The Army of the Amorites Is Destroyed.jpg"],
  [6, 10, 12, "Josué manda o sol parar", "051.Joshua Commands the Sun to Stand Still.jpg"],
  [7, 4, 21, "Jael mata Sísera", "052.Jael Kills Sisera.jpg"],
  [7, 7, 5, "Gideão escolhe 300 soldados", "054.Gideon Chooses 300 Soldiers.jpg"],
  [7, 7, 22, "Os midianitas são derrotados", "055.The Midianites Are Routed.jpg"],
  [7, 9, 5, "A morte dos filhos de Gideão", "056.The Death of Gideon's Sons.jpg"],
  [7, 9, 53, "A morte de Abimeleque", "057.The Death of Abimelech.jpg"],
  [7, 11, 34, "A filha de Jefté vai ao encontro do pai", "058.Jephthah's Daughter Comes to Meet Her Father.jpg"],
  [7, 11, 38, "As moças choram com a filha de Jefté", "059.Israelite Women Mourn with Jephthah's Daughter.jpg"],
  [7, 14, 6, "Sansão mata um leão", "060.Samson Slays a Lion.jpg"],
  [7, 15, 15, "Sansão vence os filisteus com uma queixada", "061.Samson Destroys the Philistines with an Ass' Jawbone.jpg"],
  [7, 16, 3, "Sansão carrega as portas de Gaza", "062.Samson Carries away the Gates of Gaza.jpg"],
  [7, 16, 19, "Sansão e Dalila", "063.Samson and Delilah.jpg"],
  [7, 16, 30, "A morte de Sansão", "064.The Death of Samson.jpg"],
  [8, 1, 14, "Noemi e suas noras", "068.Naomi and Her Daughters-in-Law.jpg"],
  [8, 2, 8, "Rute e Boaz", "069.Ruth and Boaz.jpg"],
  [9, 6, 13, "A arca volta para Bete-Semes", "070.The Ark Is Returned to Beth-shemesh.jpg"],
  [9, 10, 1, "Samuel unge Saul", "070A.Samuel Blesses Saul.jpg"],
  [9, 15, 33, "A morte de Agague", "071.The Death of Agag.jpg"],
  [9, 17, 49, "Davi vence Golias", "071A.David Slays Goliath.jpg"],
  [9, 18, 11, "Saul tenta matar Davi", "072.Saul Attempts to Kill David.jpg"],
  [9, 19, 12, "Davi foge pela janela", "073.David Escapes through a Window.jpg"],
  [9, 20, 41, "Davi e Jônatas", "073A.David and Jonathan.jpg"],
  [9, 26, 13, "Davi mostra a Saul que lhe poupou a vida", "074.David Shows Saul How He Spared His Life.jpg"],
  [9, 28, 14, "Saul e a médium de En-Dor", "075.Saul and the Witch of Endor.jpg"],
  [9, 31, 4, "A morte de Saul", "076.The Death of Saul.jpg"],
  [9, 31, 12, "Os de Jabes-Gileade recolhem os corpos de Saul e seus filhos", "077.Jabesh-Gileadites Recover the Bodies of Saul and His Sons.jpg"],
  [10, 2, 16, "Combate entre os soldados de Is-Bosete e de Davi", "078.Combat between Soldiers of Ish-bosheth and David.jpg"],
  [10, 12, 29, "Davi ataca os amonitas", "079.David Attacks the Ammonites.jpg"],
  [10, 18, 14, "A morte de Absalão", "080.The Death of Absalom.jpg"],
  [10, 18, 33, "Davi chora a morte de Absalão", "081.David Mourns the Death of Absalom.jpg"],
  [10, 21, 10, "Rispa protege os mortos", "082.Rizpah’s Kindness toward the Dead.jpg"],
  [10, 21, 17, "Abisai salva a vida de Davi", "083.Abishai Saves David's Life.jpg"],
  [10, 24, 15, "A praga em Jerusalém", "102A.The Plague of Jerusalem.jpg"],
  [11, 3, 27, "O julgamento de Salomão", "084.The Judgment of Solomon.jpg"],
  [11, 5, 6, "Os cedros são cortados para o Templo", "085.Cedars Are Cut Down for the Jerusalem Temple.jpg"],
  [11, 10, 1, "Salomão recebe a rainha de Sabá", "086.Solomon Receives the Queen of Sheba.jpg"],
  [11, 11, 4, "O rei Salomão na velhice", "087.King Solomon in Old Age.jpg"],
  [11, 13, 24, "O profeta desobediente é morto por um leão", "088.The Disobedient Prophet Is Slain by a Lion.jpg"],
  [11, 17, 23, "Elias ressuscita o filho da viúva de Sarepta", "089.Elijah Raises the Son of the Widow of Zarephath.jpg"],
  [11, 18, 40, "Os profetas de Baal são mortos", "090.The Prophets of Baal Are Slaughtered.jpg"],
  [11, 19, 5, "Elias é alimentado por um anjo", "091.Elijah Is Nourished by an Angel.jpg"],
  [11, 20, 29, "Os israelitas derrotam os sírios", "092.The Israelites Slaughter the Syrians.jpg"],
  [11, 22, 35, "A morte de Acabe", "093.The Death of Ahab.jpg"],
  [12, 1, 10, "Fogo do céu sobre os mensageiros de Acazias", "094.Elijah Destroys the Messengers of Ahaziah.jpg"],
  [12, 2, 11, "Elias sobe ao céu num carro de fogo", "095.Elijah Ascends to Heaven in a Chariot of Fire.jpg"],
  [12, 2, 24, "Os ursos e os rapazes de Betel", "095.Some Children Are Destroyed by Bears.jpg"],
  [12, 6, 25, "A fome em Samaria", "096.A Famine in Samaria.jpg"],
  [12, 9, 33, "A morte de Jezabel", "097.The Death of Jezebel.jpg"],
  [12, 9, 35, "Os homens de Jeú encontram os restos de Jezabel", "098.Jehu's Companions Find Jezebel's Remains.jpg"],
  [12, 11, 16, "A morte de Atalia", "099.The Death of Athaliah.jpg"],
  [12, 17, 25, "Leões atacam os estrangeiros em Samaria", "100.Foreign Nations Are Slain by Lions in Samaria.jpg"],
  [12, 19, 35, "O exército de Senaqueribe é destruído", "101.Sennacherib's Army Is Destroyed.jpg"],
  [12, 25, 7, "Os filhos de Zedequias são mortos diante dele", "102.Zedekiah's Sons Are Slaughtered before His Eyes.jpg"],
  [14, 20, 23, "Os exércitos de Amom e Moabe são destruídos", "103.The Ammonite and Moabite Armies Are Destroyed.jpg"],
  [15, 1, 7, "Ciro devolve os utensílios do Templo", "104.Cyrus Restores the Vessels of the Temple.jpg"],
  [15, 3, 10, "Começa a reconstrução do Templo", "105.The Rebuilding of the Temple Is Begun.jpg"],
  [15, 7, 13, "Artaxerxes dá liberdade aos judeus", "106.Artaxerxes Grants Freedom to the Jews.jpg"],
  [15, 9, 5, "Esdras se ajoelha em oração", "107.Ezra Kneels in Prayer.jpg"],
  [16, 2, 15, "Neemias vê as ruínas dos muros de Jerusalém", "108.Nehemiah Views the Ruins of Jerusalem's Walls.jpg"],
  [16, 8, 5, "Esdras lê a Lei para o povo", "109.Ezra Reads the Law to the People.jpg"],
  [17, 1, 12, "A rainha Vasti se recusa a obedecer Assuero", "114.Queen Vashti Refuses to Obey Ahasuerus' Command.jpg"],
  [17, 5, 2, "Ester diante do rei", "115.Esther Before the King.jpg"],
  [17, 6, 11, "A honra de Mardoqueu", "116.The Triumph of Mordecai.jpg"],
  [17, 7, 6, "Ester acusa Hamã", "117.Esther Accuses Haman.jpg"],
  [18, 1, 20, "Jó recebe as más notícias", "118.Job Hears of His Misfortunes.jpg"],
  [18, 2, 13, "Jó e seus amigos", "119.Job Speaks with His Friends.jpg"],
  [23, 1, 1, "O profeta Isaías", "120.The Prophet Isaiah.jpg"],
  [23, 13, 19, "A visão de Isaías sobre a queda da Babilônia", "121.Isaiah's Vision of the Destruction of Babylon.jpg"],
  [23, 27, 1, "A destruição do Leviatã", "122.The Destruction of Leviathan.jpg"],
  [24, 1, 1, "O profeta Jeremias", "123.The Prophet Jeremiah.jpg"],
  [24, 36, 4, "Baruque escreve as profecias de Jeremias", "123.Baruch Writes Jeremiah's Prophecies.jpg"],
  [25, 1, 1, "O povo chora a destruição de Jerusalém", "124.People Mourn over the Destruction of Jerusalem.jpg"],
  [26, 1, 1, "O profeta Ezequiel", "126.The Prophet Ezekiel.jpg"],
  [26, 37, 1, "O vale de ossos secos", "127.Ezekiel’s Vision of the Valley of Dry Bones.jpg"],
  [27, 1, 6, "Daniel entre os exilados", "128.Daniel among the Exiles.jpg"],
  [27, 3, 23, "Sadraque, Mesaque e Abede-Nego na fornalha", "129.Shadrach, Meshach and Abednego in the Furnace.jpg"],
  [27, 5, 25, "Daniel interpreta a escrita na parede", "130.Daniel Interprets the Writing on the Wall.jpg"],
  [27, 6, 22, "Daniel na cova dos leões", "131.Daniel in the Lions' Den.jpg"],
  [27, 7, 3, "A visão dos quatro animais", "132.Daniel's Vision of the Four Beasts.jpg"],
  [30, 1, 1, "O profeta Amós", "136.The Prophet Amos.jpg"],
  [32, 2, 10, "Jonas é lançado em terra pelo grande peixe", "137.Jonah Is Spewed Forth by the Whale.jpg"],
  [32, 3, 4, "Jonas prega em Nínive", "138.Jonah Preaches to the Ninevites.jpg"],
  [33, 6, 1, "Miqueias chama Israel ao arrependimento", "139.Micah Exhorts the Israelites to Repent.jpg"],
  [38, 6, 1, "A visão de Zacarias dos quatro carros", "140.Zechariah's Vision of Four Chariots.jpg"],
  [40, 3, 1, "João Batista prega no deserto", "DoreJohntheBaptistPreachingintheWilderness.jpg"],
  [40, 3, 16, "O batismo de Jesus", "Gustave Dore - John the Baptist baptizes Jesus.jpg"],
  [40, 4, 24, "Jesus cura os enfermos", "Jésus guérit les malades, par Gustave Doré.jpg"],
  [40, 5, 1, "O Sermão do Monte", "Dore Bible Sermon on the Mount.jpg"],
  [40, 14, 19, "Jesus alimenta a multidão", "JesusFeedingMultitude.jpg"],
  [40, 14, 25, "Jesus anda sobre o mar", "Jesus walks on the sea.jpg"],
  [40, 17, 2, "A transfiguração", "Gustave Dore - The Transfiguration.jpg"],
  [40, 17, 18, "Jesus cura o menino endemoninhado", "DoreJesusHealingtheLunatic.jpg"],
  [40, 21, 9, "A entrada triunfal em Jerusalém", "Gustave Dore - Jesus rides into Jerusalem on a donkey on Palm Sunday.jpg"],
  [40, 22, 21, "Dai a César o que é de César", "Gustave Dore - Jesus talks of the tribute money.jpg"],
  [40, 26, 26, "A Santa Ceia", "Jesus and the disciples at the Last Supper.jpg"],
  [40, 26, 49, "Judas trai Jesus com um beijo", "Gustave Dore - Judas betrays Jesus with a kiss.jpg"],
  [40, 26, 70, "Pedro nega Jesus", "Gustave Doré, St Peter Denying Christ.jpg"],
  [40, 27, 45, "As trevas na crucificação", "Crucifixiondarkness.jpg"],
  [41, 4, 39, "Jesus acalma a tempestade", "JesusCalmingtheTempestDore.jpg"],
  [41, 5, 41, "Jesus ressuscita a filha de Jairo", "Gustave Dore - Jesus raises the daughter of Jairus from the dead.jpg"],
  [42, 1, 28, "A anunciação", "Gustave Dore - The Annunciation.jpg"],
  [42, 2, 7, "O nascimento de Jesus", "The Birth of Jesus.jpg"],
  [42, 2, 46, "Jesus entre os doutores no Templo", "Gustave Dore - Jesus converses with the learned ones in the Temple.jpg"],
  [42, 5, 6, "A pesca maravilhosa", "La pêche miraculeuse de Gustave Doré.jpg"],
  [42, 7, 38, "A mulher arrependida aos pés de Jesus", "DoréMaryMagdaleneRepentant.jpg"],
  [42, 10, 39, "Jesus na casa de Marta e Maria", "Jesus talks with Mary and Martha in their house.jpg"],
  [42, 15, 20, "A volta do filho pródigo", "Le retour de l'enfant prodigue, par Gustave Doré.jpg"],
  [42, 16, 20, "O rico e Lázaro", "Gustave Dore Lazarus and the Rich Man.jpg"],
  [42, 18, 10, "O fariseu e o publicano", "The Pharisee and the publican.jpg"],
  [42, 22, 44, "A agonia no Getsêmani", "Jesus suffers agony in the garden of Gethseman.jpg"],
  [42, 23, 33, "Jesus é pregado na cruz", "Gustave Dore - Jesus is nailed to the cross.jpg"],
  [43, 2, 9, "As bodas de Caná", "Marriage at Cana engraving by Gustave Doré.jpg"],
  [43, 4, 7, "Jesus e a mulher samaritana", "Jesus asks the Samaritan woman for a draft from the well.jpg"],
  [43, 8, 7, "Quem não tiver pecado atire a primeira pedra", "Dore adultress.jpg"],
  [43, 19, 1, "Jesus é açoitado", "Jesus is scourged.jpg"],
  [43, 19, 2, "A coroa de espinhos", "TheCrownofThornsDore.jpg"],
  [43, 19, 5, "Eis o homem", "Christ Presented to the PeopleDore.jpg"],
  [43, 19, 17, "A chegada ao Calvário", "DoreArrivalatCalvary.jpg"],
  [43, 19, 40, "O corpo de Jesus", "DoreTheDeadchrist.jpg"],
  [44, 1, 9, "A ascensão de Jesus", "Gusta Dore - The Ascension.jpg"],
  [44, 5, 5, "A morte de Ananias", "DoreDeathofAnanias.jpg"],
  [44, 7, 59, "A morte de Estêvão", "The Death of Stephen by Gustave Doré.jpg"],
  [44, 10, 25, "Pedro na casa de Cornélio", "StPeterattheHouseofCornelius.jpg"],
  [44, 12, 7, "Pedro é libertado da prisão", "Peter'sEscapefromPrison.jpg"],
  [44, 17, 2, "Paulo prega aos tessalonicenses", "DoreStPaulPreachingtotheThessalonians.jpg"],
  [44, 21, 40, "Paulo fala à multidão depois de ser preso", "Paul Addresses the Crowd After His Arrest by Gustave Doré.jpg"],
  [66, 1, 9, "João na ilha de Patmos", "St.JohnatPatmosDore.jpg"],
  [66, 6, 8, "O cavalo amarelo", "Gustave Doré - Death on the Pale Horse (1865).jpg"],
  [66, 18, 2, "Caiu Babilônia", "Dorebabylon-fallen.jpg"],
  [66, 20, 12, "O juízo final", "LastJudgementDoré.jpg"],
  [66, 21, 10, "A nova Jerusalém", "Dore nwe jeruzalem grt.jpg"]
];

const COMMONS = 'https://commons.wikimedia.org/wiki/';
/** Endereço da imagem já reduzida pelo Wikimedia (se a original for menor, vem a original). */
const imgSrc = (file: string, w: number) => `${COMMONS}Special:FilePath/${encodeURIComponent(file)}?width=${w}`;
const filePage = (file: string) => `${COMMONS}File:${encodeURIComponent(file.replace(/ /g, '_'))}`;

export const ART_COUNT = ART.length;

export function artFor(book: number, chapter: number): Art[] {
  return ART.filter((a) => a[0] === book && a[1] === chapter);
}

function ArtCredit({ file }: { file: string }) {
  return (
    <span className="art-credit">
      Gustave Doré · domínio público ·{' '}
      <a href={filePage(file)} target="_blank" rel="noopener noreferrer">
        Wikimedia Commons
      </a>
    </span>
  );
}

/** Tela cheia para ver a gravura grande. */
function ArtViewer({ art, v, onClose }: { art: Art; v: VersionId; onClose: () => void }) {
  const book = bookByN(art[0]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="art-viewer" role="dialog" aria-modal="true" aria-label={art[3]} onClick={onClose}>
      <button className="icon-btn art-close" aria-label="Fechar" onClick={onClose}>
        <X />
      </button>
      <img src={imgSrc(art[4], 1280)} alt={art[3]} onClick={(e) => e.stopPropagation()} />
      <div className="art-viewer-cap" onClick={(e) => e.stopPropagation()}>
        <strong>{art[3]}</strong>
        <span>
          {bookName(book, v)} {art[1]}:{art[2]}
        </span>
        <ArtCredit file={art[4]} />
      </div>
    </div>
  );
}

/** Gravura(s) no topo do capítulo, quando houver. */
export function ChapterArt({ book, chapter, v }: { book: Book; chapter: number; v: VersionId }) {
  const items = artFor(book.n, chapter);
  const [open, setOpen] = useState<Art | null>(null);
  if (!items.length) return null;
  return (
    <div className="art-strip">
      {items.map((a) => (
        <figure key={a[4]} className="art-fig">
          <button className="art-img-btn" onClick={() => setOpen(a)} aria-label={`Ampliar a gravura: ${a[3]}`}>
            <img src={imgSrc(a[4], 960)} alt={a[3]} loading="lazy" decoding="async" />
          </button>
          <figcaption>
            <span className="art-title">{a[3]}</span>
            <span className="art-ref">
              {bookName(book, v)} {chapter}:{a[2]}
            </span>
            <ArtCredit file={a[4]} />
          </figcaption>
        </figure>
      ))}
      {open && <ArtViewer art={open} v={v} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Todas as gravuras, em ordem: tocar leva ao capítulo. */
function ArtGallery({ v, onClose }: { v: VersionId; onClose: () => void }) {
  const navigate = useNavigate();
  const [t, setT] = useState<'at' | 'nt'>('at');
  const list = useMemo(() => ART.filter((a) => (a[0] >= 40) === (t === 'nt')), [t]);
  return (
    <Sheet open title="A Bíblia em gravuras" onClose={onClose}>
      <div className="stack">
        <Seg
          value={t}
          onChange={setT}
          options={[
            { value: 'at', label: 'Antigo Testamento' },
            { value: 'nt', label: 'Novo Testamento' },
          ]}
        />
        <div className="art-grid">
          {list.map((a) => {
            const b = bookByN(a[0]);
            return (
              <button
                key={a[4]}
                className="art-cell"
                onClick={() => {
                  onClose();
                  navigate(chapterPath(b, a[1], a[2]));
                }}
              >
                <img src={imgSrc(a[4], 330)} alt="" loading="lazy" decoding="async" />
                <span className="art-cell-title">{a[3]}</span>
                <span className="art-cell-ref">
                  {bookName(b, v)} {a[1]}:{a[2]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="tiny muted center">
          Gravuras de Gustave Doré (1866), domínio público. Imagens do{' '}
          <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer">
            Wikimedia Commons
          </a>
          .
        </p>
      </div>
    </Sheet>
  );
}

/** Cartão na tela da Bíblia que abre a galeria. */
export function ArtShortcut({ v }: { v: VersionId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="card card-pad card-link row art-shortcut" onClick={() => setOpen(true)}>
        <div className="icon-tile gold">
          <Images />
        </div>
        <div className="grow">
          <div style={{ fontWeight: 650 }}>A Bíblia em gravuras</div>
          <div className="small muted">{ART.length} ilustrações clássicas de Gustave Doré, do Gênesis ao Apocalipse</div>
        </div>
        <ChevronRight className="chev" />
      </button>
      {open && <ArtGallery v={v} onClose={() => setOpen(false)} />}
    </>
  );
}


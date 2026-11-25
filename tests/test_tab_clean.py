"""Mechanical tab cleanup: site clutter goes, everything you play from stays."""

from jam_session_processor.tab_clean import clean_tab

STAFF = "e|---0---1---0---|\nB|---3---3---3---|\nG|---2---3---2---|"
CHART = """[Verse]
       Dm9
You've got to be crazy, you've got to have a real need
          Bbadd4
You gotta sleep on your toes when you're on the street
                                                       Asus2
You got to be able to pick out the easy meat with your eyes closed
Absus2
You've got to strike when the moment is right without thinking"""


def test_source_line_becomes_the_source():
    c = clean_tab(f"(Full tab: Ultimate Guitar, 186 votes, 4.8★)\n\n[Intro]\n{STAFF}")
    assert c.source == "Ultimate Guitar, 186 votes, 4.8★"
    assert c.text == f"[Intro]\n{STAFF}"


def test_title_block_and_credits_are_dropped():
    tab = (
        "Dogs (Pink Floyd - Animals) [Alternate]\n\nDogs\nGuitar Tabs\n"
        "Tabbed by: gilmourfan\nArtist: Pink Floyd\nhttp://example.com/dogs\n"
        f"Tuning: Standard\nCapo 2\n\n[Intro]\n{STAFF}"
    )
    c = clean_tab(tab, "Dogs", "Pink Floyd")
    assert c.text == f"Tuning: Standard\nCapo 2\n\n[Intro]\n{STAFF}"


def test_a_title_like_line_further_down_is_left_alone():
    tab = f"[Intro]\n{STAFF}\n\nDogs\n{STAFF}"
    assert clean_tab(tab, "Dogs", "Pink Floyd").text == tab


def test_email_is_cut_from_a_staff_label_and_dropped_elsewhere():
    tab = f"[Intro]\n  Zach F's [pig@hotmail.com] version:\n{STAFF}\n\nmail me at pig@hotmail.com"
    assert clean_tab(tab).text == f"[Intro]\n  Zach F's version:\n{STAFF}"


def test_legend_is_dropped():
    tab = (
        f"[Solo]\n{STAFF}\n\n************************************\n\n"
        "| x  Dead note\n| h  Hammer-on\n| p  Pull-off\n| b  Bend\n| /  Slide up\n\n"
        "************************************"
    )
    assert clean_tab(tab).text == f"[Solo]\n{STAFF}"


def test_directions_that_mention_a_technique_stay():
    tab = f"[Solo]\n      B          slide to  C#        Third verse, do this instead:\n{STAFF}"
    assert clean_tab(tab).text == tab


def test_chord_diagrams_are_dropped():
    shapes = "      G   C   Em(2)C(2)\ne|---3---0---0-----|\nB|---0---1---0-----|"
    tab = f"Chords used:\n      G   C   G7\n{STAFF}\n\n{shapes}\n\n[Intro]\n{STAFF}"
    assert clean_tab(tab).text == f"[Intro]\n{STAFF}"


def test_verses_the_chart_has_are_dropped():
    tab = (
        f"[Intro]\n{STAFF}\n\n{CHART}\nthey turn their backs on you\n\n"
        f"[Half tempo interlude]\nDm\n\n[Solo]\n(with intro chords)\n{STAFF}"
    )
    c = clean_tab(tab, sheet=CHART)
    assert c.text == f"[Intro]\n{STAFF}\n\n[Solo]\n(with intro chords)\n{STAFF}"


def test_verses_stay_when_the_chart_lacks_chords_or_words():
    tab = f"[Intro]\n{STAFF}\n\n{CHART}"
    assert clean_tab(tab, sheet="").text == tab
    assert clean_tab(tab, sheet="Verse: Dm9 | Bbadd4 | Asus2 | Absus2").text == tab


def test_a_shorthand_chart_with_lyrics_counts_as_having_the_song():
    words = "\n".join(ln for ln in CHART.split("\n")[1:] if ln.startswith("You"))
    tab = f"[Intro]\n{STAFF}\n\n{CHART}"
    sheet = f"Verse: Dm9 | Bbadd4 | Asus2 | Absus2\n\n{words}"
    assert clean_tab(tab, sheet=sheet).text == f"[Intro]\n{STAFF}"


def test_cues_and_labels_on_a_staff_stay():
    tab = (
        "[Verse]\n     You've got to be crazy, you've got to have a real need\n\n"
        f"{STAFF}\n\n  C  Dm\n  solo with above chords (C & Dm):\n{STAFF}\n\n"
        "[Verse 4]\n(guitar plays arpeggios shown for verse 2, one fret higher)\n"
        "       Dm9\nYou've got to be crazy, you've got to have a real need"
    )
    c = clean_tab(tab.replace("&", "&amp;"), sheet=CHART)
    assert c.text == tab.rsplit("\n", 2)[0]


def test_staff_lines_are_never_touched_and_cleaning_twice_changes_nothing():
    tab = f"Riffy\n\n\n\n[Intro]\n\n{STAFF}   \n\n\n\n{STAFF}\n"
    c = clean_tab(tab, "Riffy")
    assert c.text == f"[Intro]\n{STAFF}\n\n{STAFF}"
    assert clean_tab(c.text, "Riffy").text == c.text

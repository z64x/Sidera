import { useEffect, useState } from 'react';
import aceLogo from '@/ACE_logo_300px.png';

function AboutPage() {
  const [student, setStudent] = useState('');
  const [coordinator, setCoordinator] = useState('');

  useEffect(() => {
    let cancelled = false;

    window.electronAPI
      .getConfig()
      .then((config) => {
        if (cancelled) return;
        setStudent(config.thesisInfo?.student || '');
        setCoordinator(config.thesisInfo?.coordinator || '');
      })
      .catch((error) => {
        console.error('[About] Failed to load thesis info:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const saveThesisInfo = (nextStudent: string, nextCoordinator: string) => {
    window.electronAPI
      .setConfig({
        thesisInfo: {
          student: nextStudent,
          coordinator: nextCoordinator,
        },
      })
      .catch((error) => {
        console.error('[About] Failed to save thesis info:', error);
      });
  };

  const handleStudentChange = (value: string) => {
    setStudent(value);
    saveThesisInfo(value, coordinator);
  };

  const handleCoordinatorChange = (value: string) => {
    setCoordinator(value);
    saveThesisInfo(student, value);
  };

  return (
    <section className="app-about-page" aria-label="Despre Sidera">
      <div className="app-about-hero">
        <img src={aceLogo} alt="Logo ACE" />
        <div>
          <h2>Proiect de Licenta</h2>
          <p>Sidera este o interfata locala pentru agenti AI, conversatii, unelte si integrare WhatsApp.</p>
        </div>
      </div>

      <div className="app-about-people">
        <label>
          <span>Student</span>
          <input className="app-about-input" value={student} onChange={(event) => handleStudentChange(event.target.value)} />
        </label>
        <label>
          <span>Profesor Coordonator</span>
          <input className="app-about-input" value={coordinator} onChange={(event) => handleCoordinatorChange(event.target.value)} />
        </label>
      </div>

      <article className="app-about-description">
        <h3>Ce este aplicatia</h3>
        <p>
          Aplicatia este gandita ca un hub desktop pentru interactiunea cu agenti AI configurabili. Utilizatorul poate
          selecta agentul cu care discuta, poate gestiona istoricul conversatiilor, poate controla uneltele disponibile
          si poate conecta fluxuri externe precum WhatsApp prin webhook-uri si tuneluri publice.
        </p>
      </article>
    </section>
  );
}

export default AboutPage;

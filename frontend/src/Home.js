import { Card, FormControl, Dropdown, Button, Row } from "react-bootstrap";
import { Link } from "react-router-dom";
import React, { useState } from "react";
import { VscCircleFilled } from "react-icons/vsc"
import { AiOutlinePlusCircle } from "react-icons/ai"

const UserToggle = React.forwardRef(({ children, onClick }, ref) => (
    <a
        href=""
        ref={ref}
        onClick={(e) => {
        e.preventDefault();
        onClick(e);
        }}
    >
        {children}
        &#x25bc;
    </a>
));

const UserMenu = React.forwardRef(
    ({ children, style, className, 'aria-labelledby': labeledBy }, ref) => {
      const [value, setValue] = useState('');
  
      return (
        <div
          ref={ref}
          style={style}
          className={className}
          aria-labelledby={labeledBy}
        >
          <FormControl
            autoFocus
            className="mx-3 my-2 w-auto"
            placeholder="Rechercher..."
            onChange={(e) => setValue(e.target.value)}
            value={value}
          />
          <ul className="list-unstyled">
            {React.Children.toArray(children).filter(
              (child) =>
                !value || child.props.children.toLowerCase().includes(value),
            )}
          </ul>
          <Button variant="primary" className="mx-3 mb-2 w-75 text-left align-middle">
            <AiOutlinePlusCircle className="control-button"/>&nbsp;Nouvelle fiche
          </Button>
        </div>
      );
    },
  );

class Home extends React.Component {
  constructor(props) {
    super(props)
    
    this.store = props.store
    this.state = this.store.getState()
    this.unsubscribe = () => {}
  }

  componentDidMount() {
    this.unsubscribe = this.store.subscribe(() => {
      this.setState(this.store.getState())
    })
  }

  componentWillUnmount() {
    this.unsubscribe()
  }

  getInfoServer() {
    switch(this.state.status.server) {
      case 0:
          return ["red", "Erreur"]
      case 1:
          return ["orange", "Synchronisation en cours"]
      case 2:
          return ["green", "OK"]
    }
  }

  render() {
    return (
      <div className="h-vh">
        <Card className="center-box">
          <Card.Header as="h5">Plongée Virtuelle</Card.Header>
          <Card.Body>
              <Card.Title className="d-flex flex-row">Bienvenue&nbsp;
                  <Dropdown>
                      <Dropdown.Toggle as={UserToggle} className="dropdown-toggle" id="dropdown-doctor">
                      Louis DELMAS&nbsp;
                      </Dropdown.Toggle>

                      <Dropdown.Menu as={UserMenu}>
                          <Dropdown.Item>Anatole HERNOT</Dropdown.Item>
                          <Dropdown.Item>Marguerite DE JEAN DE LABATIE</Dropdown.Item>
                          <Dropdown.Item>François MAZE</Dropdown.Item>
                      </Dropdown.Menu>
                  </Dropdown>
              </Card.Title>

              <Card.Text>
                Veuillez sélectionner un patient :&nbsp;
                <Dropdown>
                      <Dropdown.Toggle as={UserToggle} className="dropdown-toggle" id="dropdown-patient">
                      Anatole HERNOT&nbsp;
                      </Dropdown.Toggle>
                      
                      <Dropdown.Menu as={UserMenu}>
                          <Dropdown.Item>Louis DELMAS</Dropdown.Item>
                          <Dropdown.Item>Marguerite DE JEAN DE LABATIE</Dropdown.Item>
                          <Dropdown.Item>François MAZE</Dropdown.Item>
                      </Dropdown.Menu>
                  </Dropdown>
              </Card.Text>
            </Card.Body>
            <Card.Footer>
                <Button variant="primary" className="mr-2">
                    <Link to="/dashboard" className="text-white">
                        Lancer l'application
                    </Link>
                </Button>
                <Button variant="secondary">
                    <Link to="/export" className="text-white">
                        Exportation des données
                    </Link>
                </Button>
          </Card.Footer>
      </Card>

      <div className="d-flex">
          <VscCircleFilled color={ this.getInfoServer()[0] } className="w-2 h-2"/>
          &nbsp;Serveur IO :&nbsp;<strong>{ this.getInfoServer()[1] }</strong>
      </div>
    </div>
    )
  }
}

export default Home;